// One drain tick: poll the dish's history, add the samples past the cursor to
// IndexedDB, advance the cursor. Called from the alarm and once on startup.
//
// The extension collects only while the browser runs, so a tick is best-effort:
// the dish's ~15-minute ring buffer backfills short gaps on the next successful
// drain, and longer gaps show as reduced coverage. A failed tick is recorded,
// not thrown — collection resumes on the next alarm.

import { DishClient, throughputMbps, type WifiClientJson } from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";
import { routerPresence } from "@core/routerPresence";
import {
  decodeHistoryWindow,
  decodeOutageEvents,
  decodeRadioReadings,
  isStarlinkOutage,
} from "@core/telemetry";
import {
  AlertEngine,
  type AlertObservation,
  type AlertTransition,
  type DeviceReading,
  type DishReading,
} from "@core/alertEngine";
import { sortBySeverity, type AlertState } from "@core/alertDefinitions";
import { ClientTotalsCore, migrateSnapshot } from "@core/clientTotals";
import { runMeters } from "./meterEnforcement";
import type { MeterHost } from "./meterHost";
import { usageKey } from "@core/clientUsage";
import { applyDrain, IndexedDbHistory, type ClientMinuteRow, type HistoryStore } from "./history";
import { packObstructionCells } from "./obstruction";
import { dishHandleUrl, routerHandleUrl } from "./endpoints";

const DRAIN_TIMEOUT_MS = 8_000;
const OBSTRUCTION_INTERVAL_MS = 3_600_000; // one snapshot an hour, as the historian records
// The odometer re-baselines rather than counts across a gap wider than this. The
// drain aims for every 30s, but chrome.alarms is not punctual — a busy or
// throttled browser delays a tick well past its period — and every gap over the
// window silently adds zero for the whole gap, not the ~1s a 1 Hz recorder
// loses. So the window is generous: five minutes still excludes a closed browser
// while tolerating alarm jitter, and the counter delta is valid across any gap
// the counter did not reset. Tune against real inter-drain gaps if they run wide.
const CLIENT_MAX_GAP_MS = 5 * 60_000;

export type DrainStatus = { ok: true; at: number } | { ok: false; at: number; message: string };

/** A tick's outcome, plus whatever crossed a threshold during it. The caller
 *  stores the status for the dashboard, announces the transitions, and reflects
 *  `active` — everything firing right now, worst first — onto the toolbar badge. */
export interface DrainResult {
  status: DrainStatus;
  alerts: AlertTransition[];
  active: AlertState[];
}

/**
 * Fold this tick's readings through the alert engine and write down what changed.
 *
 * The engine is built fresh every tick and seeded from the episodes still open in
 * IndexedDB. That is not a workaround — it is the only correct shape here. The
 * service worker is torn down between alarms, so nothing can be held in memory
 * across ticks; what the engine needs to know about the past is exactly what the
 * store already persists. A worker that woke with no memory and no seed would
 * read every ongoing alert as new and announce a water leak once a minute.
 */
async function recordAlerts(
  store: HistoryStore,
  observation: AlertObservation,
  nowMs: number,
): Promise<{ transitions: AlertTransition[]; active: AlertState[] }> {
  const open = (await store.readAlerts(nowMs)).filter((episode) => episode.endMs === null);
  const engine = new AlertEngine(open.map((e) => ({ source: e.source, key: e.key })));
  const transitions = engine.update(observation);
  if (transitions.length > 0) await store.applyAlertTransitions(transitions, nowMs);
  return { transitions, active: engine.activeAlerts() };
}

export async function drainOnce(host: MeterHost): Promise<DrainResult> {
  const at = Date.now();
  let store: HistoryStore;
  let client: DishClient;
  try {
    [store, client] = await Promise.all([
      IndexedDbHistory.open(),
      DishClient.load("dish", { handleUrl: dishHandleUrl() }),
    ]);
  } catch (error) {
    // No store means nowhere to record alerts and nowhere to read the open
    // episodes that seed the engine — the tick can do nothing at all.
    return {
      status: { ok: false, at, message: describeDrainError(error) },
      alerts: [],
      active: [],
    };
  }

  // The history drain is best-effort and isolated from alerting: the fetch and
  // its store writes sit in their own try, so an unreachable dish or a throwing
  // write leaves the alert engine below to run regardless. Alerting must not hang
  // on the history fetch — a dish that answers get_status but not get_history is
  // still healthy, and a dish that answers neither has to raise dishUnreachable,
  // which the engine can only do if it runs. The desktop recorder's poll() is
  // shaped the same way: alerts first, history after.
  let status: DrainStatus;
  // null while unknown: the satellite check reads this tick's samples, and a
  // failed history fetch drained none. It stays out of the observation entirely
  // in that case (see below), never reported as a false "no outage".
  let starlinkOutage: boolean | null = null;
  try {
    const history = await client.getHistory(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
    const now = Date.now();
    const window = decodeHistoryWindow(history, now);
    // Drains the per-minute energy deltas and the raw 1 Hz samples the charts
    // backfill from together, both from the cursor-fresh set — storing only what
    // advanced past the cursor keeps a re-drained overlap from being re-stored
    // under a fresh wall-clock timestamp (see applyDrain).
    await applyDrain(store, window, now);
    // Outages ride the same reply — the dish's event log / outage list is in the
    // history window we already fetched, so recording them costs no extra poll.
    await store.putOutages(decodeOutageEvents(history));
    // The satellite side, off the samples this tick just drained: the dish can
    // answer perfectly while none of its pings come back, and neither device
    // raises a flag for that.
    starlinkOutage = isStarlinkOutage(window.samples);
    status = { ok: true, at };
  } catch (error) {
    status = { ok: false, at, message: describeDrainError(error) };
  }

  const now = Date.now();
  // Status-derived and router feeds are best-effort: a get_status miss or an
  // unreachable (or non-Starlink) router surfaces as its own unreachability
  // alert, not as a dropped tick.
  const dish = await readDishAlerts(client);
  const router = await readRouterAlerts(store);
  const observation: AlertObservation = {
    dish,
    router: router.reading,
    // Omit the satellite side when the history fetch failed: its input is this
    // tick's samples, and there were none. The engine reads an omitted device as
    // "not asked", holding any open outage episode; reporting starlinkOutage:false
    // off no samples would instead fabricate a recovery and close it.
    ...(starlinkOutage === null ? {} : { system: { alerts: { starlinkOutage }, atMs: now } }),
  };
  await drainObstruction(store, client).catch(() => {});
  const { transitions, active } = await recordAlerts(store, observation, now);
  // Run on the clock, not on the router's reply: a cycle rolls whether or not the
  // router answered, and a rule whose device is away still has to release the
  // pause it applied when the cycle turns over.
  const meters = await runMeters(store, await loadOdometer(store), host, now, router.blocked);
  return {
    status,
    alerts: [...transitions, ...meters.transitions],
    // The engine cannot hold these: a data-limit key names one device, so no
    // static definition covers it and nothing seeds it from a stored episode.
    active: sortBySeverity([...active, ...meters.active]),
  };
}

/** The dish's live alert booleans, stamped when the reply arrived. get_status is
 *  the safe, tiny reply the historian already polls. A null alert set means it
 *  was asked and said nothing, which the engine reads as unreachable — not as
 *  everything being fine. */
async function readDishAlerts(dish: DishClient): Promise<DishReading> {
  try {
    const status = await dish.getStatus(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
    return {
      alerts: status.alerts ?? {},
      // Carried because one of the flags contradicts it: the engine needs the
      // negotiated speed to tell a dead link from the firmware's latched one.
      ethSpeedMbps: status.ethSpeedMbps,
      routerPresence: routerPresence(status),
      atMs: Date.now(),
    };
  } catch {
    return { alerts: null, atMs: Date.now() };
  }
}

/** Record an hourly obstruction-map snapshot for the time-lapse. Checked every
 *  tick but only fetched when an hour has passed, so it costs a poll once an hour. */
async function drainObstruction(store: HistoryStore, dish: DishClient): Promise<void> {
  const snapshots = await store.readObstructionSnapshots();
  const newest = snapshots[snapshots.length - 1];
  if (newest && Date.now() - newest.takenAtMs < OBSTRUCTION_INTERVAL_MS) return;
  const map = await dish.getObstructionMap(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
  if (!map.snr?.length || !map.numRows || map.numRows !== map.numCols) return;
  await store.putObstruction({
    takenAtMs: Date.now(),
    gridSize: map.numRows,
    packedCells: packObstructionCells(map.snr),
    maxThetaDeg: map.maxThetaDeg,
  });
}

/** Poll the router's own feeds — radio temperatures, its clients, and its alert
 *  set, which is what comes back. Best-effort: get_radio_stats and get_status are
 *  the safe RPCs the historian already polls (never get_ping). A router that is
 *  absent entirely (bypass mode, a third-party router) is reported as unanswered
 *  rather than as clear, the same as one that is merely unreachable. */
async function readRouterAlerts(
  store: HistoryStore,
): Promise<{ reading: DeviceReading; blocked: Map<string, boolean> }> {
  try {
    const router = await DishClient.load("router", { handleUrl: routerHandleUrl() });
    // Settled, not all-or-nothing: one RPC faltering (an unreachable client poll)
    // must not drop the radio and status feeds that shared the round trip.
    const [stats, status, clients] = await Promise.allSettled([
      router.getRadioStats(AbortSignal.timeout(DRAIN_TIMEOUT_MS)),
      router.getRouterStatus(AbortSignal.timeout(DRAIN_TIMEOUT_MS)),
      router.getWifiClients(AbortSignal.timeout(DRAIN_TIMEOUT_MS)),
    ]);
    const now = Date.now();
    if (stats.status === "fulfilled") await store.putRadio(decodeRadioReadings(stats.value), now);
    if (clients.status === "fulfilled") await recordClients(store, clients.value, now);
    return {
      reading: {
        alerts: status.status === "fulfilled" ? (status.value.alerts ?? {}) : null,
        atMs: Date.now(),
      },
      // Empty when the poll did not land, which reads as "not asked" rather than
      // as every device being free.
      blocked:
        clients.status === "fulfilled" ? await blockedByKey(store, clients.value) : new Map(),
    };
  } catch {
    return { reading: { alerts: null, atMs: Date.now() }, blocked: new Map() };
  }
}

/** What the router says about each device's block, on the keys the odometer
 *  answers to, so a rule set before an identity was merged still matches. */
async function blockedByKey(
  store: HistoryStore,
  clients: WifiClientJson[],
): Promise<Map<string, boolean>> {
  const odometer = await loadOdometer(store);
  return new Map(
    clients.map((client) => [
      odometer.resolveKey(usageKey(client.clientId, client.macAddress)),
      client.blocked === true,
    ]),
  );
}

/** Fold this poll's clients into per-minute throughput rows and the usage
 *  odometer. Rates come from the router's own 1-minute average — far too coarse
 *  for the edge detection the live page does, but exactly the resolution the 6h
 *  chart draws. Rows upsert on `${minute}:${key}`, so the two drains that now
 *  land inside one minute overwrite rather than double it; the row keeps the
 *  later reading of that minute's rolling average. The odometer deltas the byte
 *  counters, loading and re-saving its state each drain so it survives the
 *  service worker being torn down between alarms. */
async function recordClients(
  store: HistoryStore,
  clients: WifiClientJson[],
  now: number,
): Promise<void> {
  const identified = clients.filter((c) => c.clientId !== undefined || c.macAddress);
  const minute = Math.floor(now / 60_000) * 60;
  const rxOf = (c: WifiClientJson) => Number(c.rxStats?.bytes ?? 0);
  const txOf = (c: WifiClientJson) => Number(c.txStats?.bytes ?? 0);
  const rows: ClientMinuteRow[] = identified.map((c) => ({
    minute,
    key: usageKey(c.clientId, c.macAddress),
    macAddress: c.macAddress ?? "",
    name: c.givenName ?? c.name,
    downMbps: throughputMbps(c.rxStats),
    upMbps: throughputMbps(c.txStats),
    rxBytes: rxOf(c),
    txBytes: txOf(c),
  }));
  await store.putClientMinutes(rows, now);

  const odometer = await loadOdometer(store);
  const liveKeys = odometer.notePoll(
    identified.map((c) => ({ clientId: c.clientId, macAddress: c.macAddress ?? "" })),
  );
  for (const c of identified)
    odometer.observe(
      c.clientId,
      c.macAddress ?? "",
      rxOf(c),
      txOf(c),
      now,
      c.givenName ?? c.name,
      liveKeys,
      c.captiveClientId,
    );
  odometer.compact(now);
  await store.writeTotalsSnapshot(odometer.toSnapshot());
}

/** The usage odometer as the last drain left it. */
async function loadOdometer(store: HistoryStore): Promise<ClientTotalsCore> {
  const odometer = new ClientTotalsCore(CLIENT_MAX_GAP_MS);
  const snapshot = migrateSnapshot(await store.readTotalsSnapshot());
  if (snapshot) odometer.loadSnapshot(snapshot);
  return odometer;
}

function describeDrainError(error: unknown): string {
  if (error instanceof GrpcWebError) return `dish returned grpc status ${error.grpcStatus}`;
  const message = error instanceof Error ? error.message : String(error);
  // A fetch to 192.168.100.1 that never connects surfaces as a TypeError with no
  // grpc status. Below Chrome 144 that is the Local Network Access bug silently
  // blocking the service worker; at or above it the dish is simply unreachable.
  if (/fetch|network|load failed|aborted/i.test(message))
    return "couldn't reach the dish at 192.168.100.1 — on Chrome below 144, Local Network Access blocks the background fetch; otherwise the dish is offline or on another network";
  return message;
}
