// Always-on energy historian + HTTP API.
//
// Polls the dish's history ring buffer directly (reusing the frontend's
// grpc-web transport and decoder so the two never drift), folds new per-second
// power readings into per-minute energy buckets, and persists completed minutes
// to an NDJSON log. Serves day/week/month energy totals over /api/energy.
//
// Energy is integrated ONLY over minutes actually sampled — historian downtime
// (sleep, restart, Wi-Fi drop) shows up as reduced coverage, never as invented
// kWh. Short gaps (≤15 min) are backfilled losslessly from the ring buffer on
// the next poll.
//
// Run: npm run historian   (foreground; see collector/README for always-on setup)

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { createFileRegistry, fromBinary, toJson, type DescMessage } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "../core/grpcWeb.ts";
import { createRouterOrigins } from "../core/routerEndpoint.ts";
import {
  decodeHistoryWindow,
  decodeOutageEvents,
  decodeWifiHistoryEvents,
  isStarlinkOutage,
  readRouterLatencyMs,
  readRouterPingSuccessPercent,
  TelemetryAccumulator,
  type RadioStatReading,
  type TelemetrySample,
} from "../core/telemetry.ts";
import { EnergyStore, foldSamplesToMinutes, type MinuteBucket } from "./energyStore.mts";
import { energyRangeBounds, RANGES, summarizeEnergy, type Range } from "../core/energySummary.ts";
import { ThermalStore } from "./thermalStore.mts";
import { EventStore } from "./eventStore.mts";
import { ClientStore, type ClientReading } from "./clientStore.mts";
import { ClientWindow } from "./clientWindow.mts";
import { resolveRows, foldMinuteCollisions } from "../core/clientHistory.ts";
import { ClientTotalsStore } from "./clientTotals.mts";
import { ThroughputTracker } from "../core/throughputTracker.ts";
import { usageKey } from "../core/clientUsage.ts";
import { AlertStore } from "./alertStore.mts";
import { AlertEngine, type AlertObservation, type AlertTransition } from "../core/alertEngine.ts";
import { ObstructionStore, packCells } from "./obstructionStore.mts";

const DISH_URL =
  process.env.DISH_URL ?? "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
// Where the collector reads and writes. Defaults to the repo's collector/data for
// the dev process; a host (the Electron app) points it at its own per-user data dir.
const DATA_DIR = process.env.HISTORIAN_DATA_DIR ?? resolve("collector/data");
const PROTOSET_PATH = process.env.HISTORIAN_PROTOSET ?? resolve("public/dish.protoset");
const DATA_FILE = join(DATA_DIR, "energy.ndjson");
const SAMPLES_SNAPSHOT_FILE = join(DATA_DIR, "samples.json");
const THERMAL_FILE = join(DATA_DIR, "thermal.ndjson");
const EVENTS_FILE = join(DATA_DIR, "events.ndjson");
const CLIENTS_FILE = join(DATA_DIR, "clients.ndjson");
const CLIENT_SAMPLES_FILE = join(DATA_DIR, "client-samples.json");
const CLIENT_TOTALS_FILE = join(DATA_DIR, "client-totals.json");
const ALERTS_FILE = join(DATA_DIR, "alerts.ndjson");
const OBSTRUCTION_FILE = join(DATA_DIR, "obstruction.ndjson");
const LOCK_FILE = join(DATA_DIR, "historian.lock");
const PORT = Number(process.env.HISTORIAN_PORT ?? 8088);
const POLL_MS = 5_000;
/**
 * Faster than the router's ~1005 ms stats refresh, so every counter step is
 * caught as an edge rather than sampled on our clock and aliased. See
 * `src/lib/throughputTracker.ts` for why the edge is what gets measured.
 *
 * 200 ms (five polls per step) is the comfortable margin. Watchdog reboots were traced to
 * get_ping, not this poll, and running at full rate is the way to prove the
 * router stays healthy under it. If SOFTWARE_WATCHDOG reboots, drop to
 * 500 ms — two polls per step still catches every edge (one slow reply can
 * land an edge a step late, briefly smearing a per-device reading) at 2 req/s
 * instead of 5, the chattiest thing we send the router.
 */
const CLIENTS_POLL_MS = 200;
/** Recording cadence. The rates are already exact per refresh interval, so this
 *  sets how densely they are stored, independent of how often they are read. */
const CLIENTS_RECORD_MS = 1_000;
/** Matches useRadioTemps.ts's own refresh interval — no reason to hold a fresher
 *  router reading than the one consumer ever asks for. */
const RADIO_CACHE_TTL_MS = 15_000;
const GET_HISTORY_FIELD = 1007;
const GET_STATUS_FIELD = 1004;
const GET_RADIO_STATS_FIELD = 1036;
const GET_OBSTRUCTION_MAP_FIELD = 2008;
const WIFI_GET_CLIENTS_FIELD = 3002;

/**
 * The router answers get_radio_stats on its own endpoint; the dish answers it
 * Unimplemented. This is the only live temperature either device will give up.
 *
 * Its address, unlike the dish's, is one another router can be using — so it is
 * resolved per call rather than fixed here. See core/routerEndpoint.
 */
const ROUTER_PATH = "/SpaceX.API.Device.Device/Handle";

/** Pins the router to one URL and turns the fallback off — for pointing this
 *  process at a stand-in, and for the probe scripts under scripts/. */
const ROUTER_URL_OVERRIDE = process.env.ROUTER_URL ?? null;

const routerOrigins = createRouterOrigins(() =>
  Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv6" && !entry.internal)
    .map((entry) => entry!.address),
);

/**
 * Thermal flags on get_status → alerts. The dish has no temperature reading to
 * go with them — the numeric sensors live on TransceiverGetStatus, which this
 * firmware answers with Unimplemented — so these booleans are the whole signal,
 * and they only exist while they are set. Nobody records them but us.
 */
const THERMAL_ALERT_KEYS = ["thermalThrottle", "thermalShutdown", "powerSupplyThermalThrottle"];
const SAMPLE_WINDOW_MS = 6 * 3_600_000;
const SNAPSHOT_EVERY_MS = 60_000;
/** A debugging aid, not a store — nothing should ever need more than the most
 *  recent megabyte of it. */
const LOG_MAX_BYTES = 1_048_576;
const OUT_LOG_FILE = join(DATA_DIR, "historian.out.log");
const ERR_LOG_FILE = join(DATA_DIR, "historian.err.log");

const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync(PROTOSET_PATH)),
);

/** Fail at startup, not on the first poll, if the protoset lacks a message. */
function requireMessage(typeName: string): DescMessage {
  const schema = registry.getMessage(typeName);
  if (!schema) throw new Error(`${typeName} missing from protoset`);
  return schema;
}

const responseSchema = requireMessage("SpaceX.API.Device.Response");

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return bytes;
}

/** SpaceX.API.Device.Request with one empty oneof sub-message selected by field number. */
function requestBytes(fieldNumber: number): Uint8Array {
  return new Uint8Array([...encodeVarint((fieldNumber << 3) | 2), 0]);
}

/**
 * How long any one device call may take. Matches the browser's polls, which
 * bound every request for the same reason.
 *
 * A dish that is powered off does not refuse the connection — it goes silent,
 * and the TCP connect sits there until the OS gives up (~75s). Node's fetch
 * imposes no deadline of its own, so an unbounded call blocks this whole cycle
 * for as long as that takes. Every alert this process records is derived from
 * how long a call took to fail, so an unbounded call does not merely stall the
 * poll: it invents the outage it then writes down.
 */
const REQUEST_TIMEOUT_MS = 4_000;
/** The obstruction map is a 900+ float grid and legitimately slower to build. */
const OBSTRUCTION_TIMEOUT_MS = 10_000;

/**
 * The one way this process talks to a device.
 *
 * The deadline lives here rather than at the call sites so it cannot be left
 * off: an unbounded call is not something to remember to avoid, it is something
 * that should be unwritable. Decoding rides along because every caller did the
 * same three steps to get from bytes to JSON.
 */
async function deviceCall(
  url: string,
  fieldNumber: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const bytes = await grpcWebUnaryCall(
    url,
    requestBytes(fieldNumber),
    AbortSignal.timeout(timeoutMs),
  );
  return toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as Record<
    string,
    unknown
  >;
}

/**
 * A device call to the router, tried against each address it may be reachable at.
 *
 * `timeoutMs` bounds the whole thing, not each attempt. That is the point: this
 * process derives outages from how long a call took to fail, so a fallback that
 * doubled the time a dead router takes to report dead would write down outages
 * twice as long as they were. Spending one budget across the attempts keeps the
 * recording identical to what a single call produced.
 *
 * It also decides, correctly, when the fallback is worth trying at all. An
 * address taken by another router refuses instantly, leaving nearly the whole
 * budget for the IPv6 attempt that will succeed. A genuinely absent router
 * consumes the budget going silent, and no second address would have answered
 * anyway.
 */
async function routerCall(
  fieldNumber: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  if (ROUTER_URL_OVERRIDE) return deviceCall(ROUTER_URL_OVERRIDE, fieldNumber, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  return routerOrigins.run((origin) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("router call budget spent");
    return deviceCall(origin + ROUTER_PATH, fieldNumber, remaining);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getHistory(): Promise<any> {
  const json = (await deviceCall(DISH_URL, GET_HISTORY_FIELD)) as { dishGetHistory?: unknown };
  return json.dishGetHistory ?? {};
}

// get_history (1007) is a shared request: sent to the router it answers with
// wifi_get_history — the router's own event log (power cycles, reboots, software
// updates, client band-switching, …), the same UXEvent shape as the dish's.
async function getWifiHistory(): Promise<{ eventLog?: { events?: unknown[] } }> {
  const json = (await routerCall(GET_HISTORY_FIELD)) as {
    wifiGetHistory?: { eventLog?: { events?: unknown[] } };
  };
  return json.wifiGetHistory ?? {};
}

/**
 * `toJson` omits false fields, so an alert key is absent unless it is true —
 * `=== true` is the check, and absence means clear.
 */
async function getStatusAlerts(): Promise<{
  alerts: Record<string, boolean>;
  ethSpeedMbps?: number;
}> {
  const json = (await deviceCall(DISH_URL, GET_STATUS_FIELD)) as {
    dishGetStatus?: { alerts?: Record<string, boolean>; ethSpeedMbps?: number };
  };
  return {
    alerts: json.dishGetStatus?.alerts ?? {},
    // Carried alongside the flags because one of them contradicts it: the engine
    // needs the negotiated speed to tell a real dead link from a latched flag.
    ethSpeedMbps: json.dishGetStatus?.ethSpeedMbps,
  };
}

/**
 * The router's whole get_status. One call, because two things here want it: the
 * alert set and the router's own ping to the PoP. Asking twice per poll is two
 * round trips for one reply.
 */
async function getRouterStatus(): Promise<{
  alerts?: Record<string, boolean>;
  popPingLatencyMs?: number;
  popPingDropRate5m?: number;
}> {
  const json = (await routerCall(GET_STATUS_FIELD)) as {
    wifiGetStatus?: {
      alerts?: Record<string, boolean>;
      popPingLatencyMs?: number;
      popPingDropRate5m?: number;
    };
  };
  return json.wifiGetStatus ?? {};
}

/**
 * The router's readings as of the last poll, held so the sample stamping can
 * use a reply already fetched this cycle. Null whenever the router failed to
 * answer, so an unreachable router leaves a gap rather than a repeated value.
 *
 * The historian has to be what records these. The router keeps no history for
 * either: all it gives up is a point-in-time value, so the series only exist if
 * something samples them continuously and persists them — which is the whole
 * job of this process. Read live in the browser they could never fill a 1H or
 * 6H window, and a chart that can't answer its own time filter is not worth
 * drawing.
 *
 * Both come out of the ONE get_status this file already polls. Ping success is
 * NEVER to be sourced from get_ping (1009): three trials on 2026-07-20 — at
 * 2s+5s, then alone at 30s after hours of stable control — each rebooted the
 * router within ~15 minutes, while this get_status poll ran at 5s all day
 * without incident. popPingDropRate5m is the router's own rolling five-minute
 * measure, so it needs no smoothing here.
 */
let latestRouterLatencyMs: number | null = null;
let latestRouterPingSuccessPercent: number | null = null;

/**
 * Wi-Fi radio temperatures from the router. Only `temp2` is ever populated —
 * the schema's `temp` stays absent on this firmware — so read that and fall
 * back rather than assume.
 */
async function getRadioReadings(): Promise<RadioStatReading[]> {
  const json = (await routerCall(GET_RADIO_STATS_FIELD)) as {
    getRadioStats?: {
      radioStats?: Array<{
        band?: string;
        thermalStatus?: { temp?: number; temp2?: number; dutyCycle?: number };
      }>;
    };
  };
  const readings: RadioStatReading[] = [];
  for (const radio of json.getRadioStats?.radioStats ?? []) {
    const tempC = radio.thermalStatus?.temp2 ?? radio.thermalStatus?.temp;
    if (tempC === undefined || !Number.isFinite(tempC)) continue;
    readings.push({
      band: radio.band ?? "unknown",
      tempC,
      dutyCycle: radio.thermalStatus?.dutyCycle ?? 100,
    });
  }
  return readings;
}

/**
 * Per-device rates from the router. The router reports only an instantaneous
 * rate, so this is the only place a per-device series can come from — and it has
 * to be recorded here, not in the browser, to exist when nobody is looking.
 * The 1-minute average is absent on freshly-joined clients; fall back to the
 * 15s one rather than record a busy device as idle.
 */
/** proto3 JSON renders a NaN double as the string "NaN"; the router sends that
 *  for quiet clients, so these values are not safely arithmetic. */
interface WireStats {
  bytes?: string;
  throughputMbpsLast1mAvg?: number | "NaN";
  throughputMbpsLast15sAvg?: number | "NaN";
}

/** Turns the router's cumulative byte counters into real per-second rates.
 *  Module-level because it has to remember the previous poll. */
const clientThroughput = new ThroughputTracker();

/** Per-device monthly data-usage odometer. Accumulates the same byte counters,
 *  reset-aware, so a total survives the reconnects that zero the router's own. */
const clientTotals = new ClientTotalsStore(CLIENT_TOTALS_FILE);

function finiteMbps(value: number | "NaN" | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

interface WireClient {
  macAddress?: string;
  name?: string;
  givenName?: string;
  role?: string;
  /** The router's per-device id — what its own name store is keyed by, and the
   *  only thing telling apart two devices behind one vendor-masked MAC. Reissued
   *  with the MAC, so a private-address rotation produces a new one. */
  clientId?: number;
  /** Per-client hash the router derives from something it does not expose; the
   *  odometer uses it to recognise a device whose clientId was reissued. */
  captiveClientId?: string;
  ipAddress?: string;
  rxStats?: WireStats;
  txStats?: WireStats;
}

/** The roster entry a counter reading belongs to. Falls back through IP to the
 *  MAC itself, which for a normal (unshared) MAC is the previous behaviour. */
function entryIdOf(client: WireClient): string {
  if (client.clientId !== undefined) return String(client.clientId);
  return client.ipAddress ?? client.macAddress ?? "";
}

async function getClientReadings(): Promise<ClientReading[]> {
  const json = (await routerCall(WIFI_GET_CLIENTS_FIELD)) as {
    wifiGetClients?: { clients?: WireClient[] };
  };
  // One reading per roster entry, not per MAC. The router masks each client's MAC
  // to its vendor OUI, so a same-vendor group arrives as several entries wearing
  // one MAC; folding them together made every member report the group's summed
  // rate as its own. Each entry already deltas against its own counter stream, so
  // there is nothing to merge — only an identity to carry through.
  const readings: ClientReading[] = [];
  const liveEntryKeys: string[] = [];
  const nowMs = Date.now();
  // Every live client this poll, so the odometer can learn which OUIs are shared
  // and tell an orphan bucket from a live one before it folds any counter in.
  const clients = (json.wifiGetClients?.clients ?? []).filter(
    (client): client is WireClient & { macAddress: string } =>
      !!client.macAddress && (!client.role || client.role === "CLIENT"),
  );
  const totalsLiveKeys = clientTotals.notePoll(
    clients.map((client) => ({ clientId: client.clientId, macAddress: client.macAddress })),
  );
  for (const client of clients) {
    const entryId = entryIdOf(client);
    const entryKey = `${client.macAddress}|${entryId}`;
    liveEntryKeys.push(entryKey);

    const rxBytes = client.rxStats?.bytes;
    const txBytes = client.txStats?.bytes;
    // The router intermittently returns a client with no stats block at all.
    // Absent counters are "we did not get a reading", not zero bytes moved —
    // passing 0 here would read as the counter resetting and, worse, would be
    // recorded as a one-second dropout on an otherwise busy device.
    const counters =
      rxBytes === undefined || txBytes === undefined
        ? undefined
        : { rxBytes: Number(rxBytes), txBytes: Number(txBytes) };

    // Fold the raw counter into the monthly odometer. Done here, at the fast
    // poll, so a re-association's counter reset is caught the moment it happens
    // rather than a second later when it has already climbed back up.
    if (counters) {
      clientTotals.observe(
        client.clientId,
        client.macAddress,
        counters.rxBytes,
        counters.txBytes,
        nowMs,
        client.givenName ?? client.name,
        totalsLiveKeys,
        client.captiveClientId,
      );
    }

    // 15s, not 1m: the shorter window is closer to the truth whenever a delta is
    // unavailable, and txStats has no 1m field at all — preferring it would leave
    // download smoothed over 60s and upload over 15s on the same chart.
    const rates = clientThroughput.rates(entryKey, counters, nowMs, {
      downMbps: finiteMbps(client.rxStats?.throughputMbpsLast15sAvg) ?? 0,
      upMbps: finiteMbps(client.txStats?.throughputMbpsLast15sAvg) ?? 0,
    });

    readings.push({
      // usageKey, not entryId: entryId falls back through IP to keep two
      // clientId-less entries apart in the rate tracker, but the stored key has
      // to be the one the odometer and the browser both join on.
      key: usageKey(client.clientId, client.macAddress),
      macAddress: client.macAddress,
      name: client.givenName ?? client.name,
      downMbps: rates.downMbps,
      upMbps: rates.upMbps,
      rxBytes: counters?.rxBytes ?? 0,
      txBytes: counters?.txBytes ?? 0,
    });
  }
  clientThroughput.retain(liveEntryKeys);
  return readings;
}

const store = new EnergyStore(DATA_FILE);
// Compaction also runs on construction; repeat daily for a historian that stays
// up for months at a stretch.
const COMPACT_EVERY_MS = 24 * 3_600_000;
const thermalStore = new ThermalStore(THERMAL_FILE);
const eventStore = new EventStore(EVENTS_FILE);
const obstructionStore = new ObstructionStore(OBSTRUCTION_FILE);
const clientStore = new ClientStore(CLIENTS_FILE);
const clientWindow = new ClientWindow(CLIENT_SAMPLES_FILE);
const alertStore = new AlertStore(ALERTS_FILE);

/**
 * Decides what changed; this file only writes it down and passes it on. Seeded
 * from the episodes still open on disk so a restart does not read every ongoing
 * alert as new — a recorder that restarts nightly would otherwise re-announce
 * water in the dish every night until someone dried it.
 */
const alertEngine = new AlertEngine(
  alertStore
    .all()
    .filter((episode) => episode.endMs === null)
    .map((episode) => ({ source: episode.source, key: episode.key })),
);

/**
 * Told about every alert transition as it happens.
 *
 * The recorder's own job ends at writing the episode down: it has no user in
 * front of it, and in the launchd deployment there is nobody to tell. A host
 * that does have someone — the desktop app, which runs this in its main process
 * — subscribes here and puts the alert on screen. That is what lets a dish going
 * offline reach the user with no window open, which is the entire point of
 * running a recorder rather than a dashboard.
 */
const alertListeners = new Set<(transitions: AlertTransition[]) => void>();

export function onAlertTransitions(listener: (transitions: AlertTransition[]) => void): () => void {
  alertListeners.add(listener);
  return () => {
    alertListeners.delete(listener);
  };
}

/**
 * A live throughput feed for a readout that outlives an open window — the desktop
 * menu-bar number shown while the dashboard is closed.
 *
 * While enabled it polls the dish's get_status once a second and hands each
 * reading to the listeners: the same downlink/uplink the dashboard's live tiles
 * draw, so the two agree. It stays off until switched on, so nothing here polls
 * the dish unless a readout is actually showing — and its owner starts it only in
 * the gap where no window is running the equivalent poll, so the dish is never
 * asked twice a second.
 */
export interface ThroughputSample {
  downBps: number;
  upBps: number;
  /** When the reading was taken, so a stale readout can be told apart from a
   *  genuinely idle link by whoever renders it. */
  atMs: number;
}

const throughputListeners = new Set<(sample: ThroughputSample) => void>();

export function onThroughput(listener: (sample: ThroughputSample) => void): () => void {
  throughputListeners.add(listener);
  return () => {
    throughputListeners.delete(listener);
  };
}

const LIVE_THROUGHPUT_POLL_MS = 1_000;
let liveThroughputTimer: ReturnType<typeof setInterval> | null = null;

/** Fetch one dish get_status and publish its throughput. A failed fetch publishes
 *  nothing — the readout's owner ages the last number out to zero on its own — and
 *  is swallowed so a momentary miss doesn't tear down the once-a-second loop. */
async function pollLiveThroughput(): Promise<void> {
  let status: { downlinkThroughputBps?: number; uplinkThroughputBps?: number } | undefined;
  try {
    const json = (await deviceCall(DISH_URL, GET_STATUS_FIELD)) as {
      dishGetStatus?: { downlinkThroughputBps?: number; uplinkThroughputBps?: number };
    };
    status = json.dishGetStatus;
  } catch {
    return;
  }
  if (!status) return;
  const sample: ThroughputSample = {
    downBps: status.downlinkThroughputBps ?? 0,
    upBps: status.uplinkThroughputBps ?? 0,
    atMs: Date.now(),
  };
  for (const listener of throughputListeners) listener(sample);
}

/** Start or stop the once-a-second dish poll behind the live feed. Idempotent, so
 *  the owner can drive it straight from its own gate each tick: a repeated call
 *  with the state it is already in does nothing. */
export function setLiveThroughputEnabled(enabled: boolean): void {
  if (enabled === (liveThroughputTimer !== null)) return;
  if (enabled) {
    void pollLiveThroughput();
    liveThroughputTimer = setInterval(() => void pollLiveThroughput(), LIVE_THROUGHPUT_POLL_MS);
  } else if (liveThroughputTimer !== null) {
    clearInterval(liveThroughputTimer);
    liveThroughputTimer = null;
  }
}

/** Persist a cycle's transitions, then hand them to whoever is listening. */
function recordAlertTransitions(transitions: AlertTransition[]): void {
  if (transitions.length === 0) return;
  for (const transition of transitions) {
    const { source, key, atMs, kind } = transition;
    if (kind === "fired") alertStore.open(source, key, atMs);
    else alertStore.close(source, key, atMs);
    // The service's diary. It runs unattended under launchd with no window and
    // no operator, so "did it see the outage?" is answerable only from what it
    // wrote down. Every transition is logged, not a chosen few, so an
    // unreachable device leaves a trace in the log even though it fires no
    // heat key.
    console.log(`[historian] alert ${kind}: ${source}:${key}`);
    // The thermal log is the alert log narrowed to the three heat keys. Driven
    // off the same transitions rather than its own comparison, so it can never
    // disagree with the alert log about when the dish got hot.
    if (source === "dish" && THERMAL_ALERT_KEYS.includes(key)) {
      if (kind === "fired") thermalStore.open(key, atMs);
      else thermalStore.close(key, atMs);
    }
  }
  for (const listener of alertListeners) listener(transitions);
}

let latestRadio: { readings: RadioStatReading[]; atMs: number } | null = null;
// The minutes seen but not yet finalized (the in-progress minute at the head of
// the ring buffer), each replaced every poll with the authoritative recompute
// from the buffer. RAM-only on purpose: it is rebuilt from the dish's 15-minute
// ring on the very next poll, so a restart loses nothing — the durable energy
// log holds only minutes already finalized, gated by lastWrittenMinute.
const openMinuteBuckets = new Map<number, MinuteBucket>();

// Rolling full-resolution window served to the frontend so page reloads (and
// historian restarts, via the snapshot file) never reset the charts.
const sampleWindow = new TelemetryAccumulator(SAMPLE_WINDOW_MS);

function loadSampleSnapshot(): void {
  if (!existsSync(SAMPLES_SNAPSHOT_FILE)) return;
  try {
    const persisted = JSON.parse(readFileSync(SAMPLES_SNAPSHOT_FILE, "utf8")) as TelemetrySample[];
    const cutoffMs = Date.now() - SAMPLE_WINDOW_MS;
    latestSamples = sampleWindow.seed(persisted.filter((sample) => sample.timestampMs >= cutoffMs));
    console.log(`[historian] restored ${latestSamples.length} samples from snapshot`);
  } catch (error) {
    console.warn(`[historian] snapshot unreadable, starting fresh: ${(error as Error).message}`);
  }
}

/**
 * History can only hold what this process witnessed. The sample snapshot is
 * rewritten every minute while running, so its mtime is a heartbeat: a boot
 * that finds it stale means the recorder was off in between. Record the gap
 * itself as an episode, so absence in the History tab reads "not recorded"
 * rather than implying "nothing happened".
 */
function recordRecorderGap(): void {
  if (!existsSync(SAMPLES_SNAPSHOT_FILE)) return;
  const lastAliveMs = statSync(SAMPLES_SNAPSHOT_FILE).mtimeMs;
  const nowMs = Date.now();
  // Under three minutes is a restart, not an outage worth a history row.
  if (nowMs - lastAliveMs < 3 * 60_000) return;
  alertStore.open("system", "recorderOff", lastAliveMs);
  alertStore.close("system", "recorderOff", nowMs);
}

/** Round for the snapshot/API payload — chart precision, not lab precision. */
function compactSample(sample: TelemetrySample): TelemetrySample {
  return {
    timestampMs: sample.timestampMs,
    latencyMs: sample.latencyMs === null ? null : Math.round(sample.latencyMs * 10) / 10,
    dropRate: Math.round(sample.dropRate * 1000) / 1000,
    downlinkBps: Math.round(sample.downlinkBps),
    uplinkBps: Math.round(sample.uplinkBps),
    powerW: Math.round(sample.powerW * 10) / 10,
    // Finite-checked rather than null-checked: a snapshot written before this
    // field existed restores it as undefined, which must not become NaN here.
    routerLatencyMs: Number.isFinite(sample.routerLatencyMs)
      ? Math.round(sample.routerLatencyMs! * 10) / 10
      : null,
    routerPingSuccessPercent: Number.isFinite(sample.routerPingSuccessPercent)
      ? Math.round(sample.routerPingSuccessPercent! * 100) / 100
      : null,
  };
}

let latestSamples: TelemetrySample[] = [];

function writeSampleSnapshot(): void {
  if (latestSamples.length === 0) return;
  try {
    // temp + rename so a crash mid-write never tears the snapshot
    const tempPath = `${SAMPLES_SNAPSHOT_FILE}.tmp`;
    writeFileSync(tempPath, JSON.stringify(latestSamples.map(compactSample)));
    renameSync(tempPath, SAMPLES_SNAPSHOT_FILE);
  } catch (error) {
    console.warn(`[historian] snapshot write failed: ${(error as Error).message}`);
  }
}

/**
 * Caps launchd's redirected stdout/stderr logs, which otherwise grow forever.
 * The running process holds its stdout/stderr file descriptor open for its
 * entire lifetime, so rotation copies the content to a backup and truncates
 * the original in place — same inode, same descriptor, new writes land in
 * what is now an empty file.
 */
function rotateLogIfLarge(path: string): void {
  try {
    if (statSync(path).size < LOG_MAX_BYTES) return;
    writeFileSync(`${path}.1`, readFileSync(path));
    writeFileSync(path, "");
  } catch {
    // no log file at this path (e.g. not running under launchd) — nothing to rotate
  }
}

/**
 * Record alert edges from both devices. An unreachable device means no reading,
 * not a cleared alert, so a failed fetch leaves that device's open episodes open
 * and never touches the other's.
 *
 * The dish's status is fetched once and fed to two stores: thermalStore (the
 * three thermal keys, kept for the event log) and alertStore (every key). The
 * duplication for thermal keys is deliberate — the event log reads thermalStore.
 */
/**
 * Hourly obstruction snapshot for the time-lapse.
 *
 * This is a NEW dish call, but a rare one: the map only changes as the dish
 * accumulates sky coverage, and one reading an hour is the cadence the browser
 * already used. `isDue` is checked first, so a historian restart does not take a
 * fresh reading if the last one is still recent.
 */
async function pollObstruction(): Promise<void> {
  const now = Date.now();
  if (!obstructionStore.isDue(now)) return;
  try {
    const json = (await deviceCall(
      DISH_URL,
      GET_OBSTRUCTION_MAP_FIELD,
      OBSTRUCTION_TIMEOUT_MS,
    )) as {
      dishGetObstructionMap?: {
        numRows?: number;
        numCols?: number;
        snr?: number[];
        maxThetaDeg?: number;
      };
    };
    const map = json.dishGetObstructionMap;
    if (!map?.snr?.length || !map.numRows || map.numRows !== map.numCols) return;
    const snapshots = obstructionStore.record({
      takenAtMs: now,
      gridSize: map.numRows,
      packedCells: packCells(map.snr),
      maxThetaDeg: map.maxThetaDeg,
    });
    console.log(`[historian] obstruction snapshot recorded (${snapshots.length} kept)`);
  } catch (error) {
    console.warn(`[historian] obstruction snapshot failed: ${(error as Error).message}`);
  }
}

/**
 * Every episode boundary below is stamped after its call returns, never from a
 * clock read at the top of the cycle. A timestamp taken before an await does not
 * describe the observation, it describes the intention to make it — and with a
 * request that can sit for its full deadline the two are seconds apart. Episodes
 * on disk carried that error: overlapping duplicates, and one that closed five
 * seconds before it opened.
 */
async function pollAlerts(): Promise<void> {
  const observation: AlertObservation = {};
  try {
    const dishStatus = await getStatusAlerts();
    observation.dish = {
      alerts: dishStatus.alerts,
      ethSpeedMbps: dishStatus.ethSpeedMbps,
      atMs: Date.now(),
    };
  } catch {
    // No reply. A null alert set is the engine's "asked and got nothing", which
    // holds the dish's own episodes open — an unreachable dish means no reading,
    // not a cleared alert — and raises the unreachability itself, so it survives
    // in history instead of only being a console warning.
    observation.dish = { alerts: null, atMs: Date.now() };
  }
  try {
    // One status reply, two consumers: the alert set, and the ping the sample
    // stamping picks up below.
    const routerStatus = await getRouterStatus();
    latestRouterLatencyMs = readRouterLatencyMs(routerStatus.popPingLatencyMs);
    latestRouterPingSuccessPercent = readRouterPingSuccessPercent(routerStatus.popPingDropRate5m);
    observation.router = { alerts: routerStatus.alerts ?? {}, atMs: Date.now() };
  } catch {
    // router unreachable (or bypass mode) — leave its open episodes open
    latestRouterLatencyMs = null;
    latestRouterPingSuccessPercent = null;
    observation.router = { alerts: null, atMs: Date.now() };
  }
  // The satellite side, judged from the samples the previous cycle appended.
  // Neither device flags this — the dish answers perfectly while none of its
  // pings come back — so nothing raises it unless something watches for it, and
  // in the tray this process is the only something there is.
  observation.system = {
    alerts: { starlinkOutage: isStarlinkOutage(latestSamples) },
    atMs: Date.now(),
  };
  recordAlertTransitions(alertEngine.update(observation));
}

/**
 * Radio temperatures feed one on-demand UI panel and nothing persists them, so
 * fetching happens lazily: a request only reaches the router when the cache is
 * older than RADIO_CACHE_TTL_MS, and concurrent callers share one in-flight
 * request instead of each firing their own.
 *
 * The router is a separate device on a separate address: it can be unreachable
 * while the dish is fine, so its failures stay quiet and just serve the last
 * known reading rather than reading as a dish problem.
 */
let radioRefreshInFlight: Promise<void> | null = null;
async function radioTempSnapshot(): Promise<{ readings: RadioStatReading[]; atMs: number } | null> {
  const isStale = !latestRadio || Date.now() - latestRadio.atMs >= RADIO_CACHE_TTL_MS;
  if (isStale) {
    if (!radioRefreshInFlight) {
      radioRefreshInFlight = (async () => {
        try {
          const readings = await getRadioReadings();
          if (readings.length > 0) latestRadio = { readings, atMs: Date.now() };
        } catch {
          // router unreachable (or not a Starlink router) — leave the last reading be
        }
      })().finally(() => {
        radioRefreshInFlight = null;
      });
    }
    await radioRefreshInFlight;
  }
  return latestRadio;
}

/**
 * Same contract as radioTempSnapshot: the router is a separate box and its failures
 * must not read as a dish problem.
 *
 * Runs on its own fast timer rather than the main 5s cycle, because unlike the
 * dish this reading has no buffer behind it — the router reports a counter and
 * remembers nothing, so whatever is not sampled here is gone. (The per-client
 * history RPC that would have supplied a buffer returns all zeros on this
 * firmware; see the note in src/lib/telemetry.ts.)
 *
 * Polling is decoupled from recording: it runs at 5 Hz to catch the router's
 * counter steps as they happen, while the resulting rates are written to the
 * stores once a second. Recording every poll would quintuple both tiers to store
 * the same per-second numbers five times over.
 */
/** Newest rates from the fast poll, waiting to be recorded. */
let latestClientReadings: ClientReading[] = [];
// A router that stops answering must not stack a request every poll until the
// connection budget starves the dish poll — at 200ms this is the poll where
// overlap would bite first. The guard is `nonOverlapping` at the scheduler,
// the same one every other poll gets.
async function pollClients(): Promise<void> {
  try {
    const readings = await getClientReadings();
    if (readings.length > 0) latestClientReadings = readings;
  } catch {
    // router unreachable (or bypass mode) — keep what we have
  }
}

/**
 * Write the newest rates to both tiers: the raw window behind the 15-minute
 * detail chart, and the per-minute store behind the 6h view.
 *
 * Rates are held between the router's counter steps, so a recording tick that
 * falls between two edges records the last completed interval rather than a gap.
 * With a 1000 ms tick against a 1005 ms refresh the two drift, so roughly once
 * every few minutes an interval is recorded twice or skipped — which costs a
 * duplicated point, never a wrong value, because each recorded number is still
 * exactly one refresh interval's measured traffic.
 */
function recordClients(): void {
  if (latestClientReadings.length === 0) return;
  const now = Date.now();
  clientWindow.ingest(latestClientReadings, now);
  clientStore.ingest(latestClientReadings, now);
}

/**
 * Backfill each device's opening monthly total from the per-minute history the
 * historian already holds on disk, so a first-ever run does not start everyone
 * at zero. Integrates the recorded mean rates into bytes, clamped to this month
 * so last month's traffic never counts into it. No-op per device once a total
 * exists — a restart reloads the accumulated figure rather than re-seeding.
 */
function seedClientTotals(nowMs: number): void {
  const monthStart = new Date(nowMs);
  monthStart.setHours(0, 0, 0, 0);
  monthStart.setDate(1);
  const monthStartSec = Math.floor(monthStart.getTime() / 1000);
  const perMac = new Map<string, { rx: number; tx: number; lastMs: number; name?: string }>();
  for (const row of clientStore.history(6)) {
    if (row.minute < monthStartSec) continue;
    const agg = perMac.get(row.macAddress) ?? { rx: 0, tx: 0, lastMs: 0, name: row.name };
    // downMbps/upMbps are the minute's mean rate; × 60 s ÷ 8 bits = bytes.
    agg.rx += (row.downMbps * 1_000_000 * 60) / 8;
    agg.tx += (row.upMbps * 1_000_000 * 60) / 8;
    agg.lastMs = Math.max(agg.lastMs, row.minute * 1_000);
    if (row.name) agg.name = row.name;
    perMac.set(row.macAddress, agg);
  }
  let seeded = 0;
  for (const [mac, agg] of perMac) {
    // Seed at the minute the device was last recorded, not now: most of this
    // history belongs to devices that are currently offline, and stamping them
    // with `nowMs` would have the list report every one of them as active. seed()
    // is a no-op (returns false) when any bucket already covers this MAC — a
    // clientId-keyed one after a restart — so it never lays down a second bucket
    // that the next poll would double-count.
    if (clientTotals.seed(mac, Math.round(agg.rx), Math.round(agg.tx), agg.lastMs, agg.name))
      seeded++;
  }
  if (seeded > 0) console.log(`[historian] seeded ${seeded} device total(s) from recorded history`);
}

/**
 * Wrap a poll so it can never overlap itself: while one run is in flight, the
 * next tick is skipped rather than queued.
 *
 * A cycle makes several device calls in sequence, so even with every call
 * bounded it can outlast its own interval when devices are slow — and two
 * cycles running at once against the same stores interleave their observations,
 * which is how the alert log ended up with overlapping episodes. Guarding at the
 * scheduler means a poll cannot be added without the property; the alternative,
 * a boolean each function remembers to check, is the version that gets forgotten.
 */
function nonOverlapping(run: () => Promise<void>): () => Promise<void> {
  let inFlight = false;
  return async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await run();
    } finally {
      inFlight = false;
    }
  };
}

async function poll(): Promise<void> {
  await pollAlerts();

  let history: Awaited<ReturnType<typeof getHistory>>;
  try {
    history = await getHistory();
  } catch (error) {
    console.warn(`[historian] dish unreachable: ${(error as Error).message}`);
    return;
  }

  // The dish's event list rolls and resets on reboot; fold each poll's view
  // into the durable log while we still have it.
  const newEvents = eventStore.upsert(decodeOutageEvents(history));
  if (newEvents > 0) console.log(`[historian] recorded ${newEvents} event(s) from the dish log`);

  // The router keeps its own event log (power cycles, band-switching, updates …)
  // in wifi_get_history — same rolling/reset behaviour, so persist it the same way.
  try {
    const wifiHistory = await getWifiHistory();
    const newRouterEvents = eventStore.upsert(decodeWifiHistoryEvents(wifiHistory));
    if (newRouterEvents > 0)
      console.log(`[historian] recorded ${newRouterEvents} event(s) from the router log`);
  } catch (error) {
    console.warn(`[historian] router history unreachable: ${(error as Error).message}`);
  }

  // Stamped onto the samples this poll appends, from the status pollAlerts read
  // at the top of this same cycle — so the router series persists in the
  // snapshot alongside the dish's and answers the same 15M/1H/6H filter.
  const now = Date.now();
  const window = decodeHistoryWindow(history, now);
  latestSamples = sampleWindow.ingest(
    history,
    now,
    {
      latencyMs: latestRouterLatencyMs,
      pingSuccessPercent: latestRouterPingSuccessPercent,
    },
    window,
  );
  const perMinute = foldSamplesToMinutes(window.samples);

  // Replace (not accumulate) so re-seeing a minute across overlapping polls is idempotent.
  for (const [minute, bucket] of perMinute) {
    if (minute > store.lastWrittenMinute) openMinuteBuckets.set(minute, bucket);
  }

  const currentMinute = Math.floor(now / 60_000) * 60;
  const completed = [...openMinuteBuckets.keys()]
    .filter((minute) => minute < currentMinute)
    .sort((a, b) => a - b);
  for (const minute of completed) {
    store.append(openMinuteBuckets.get(minute)!);
    openMinuteBuckets.delete(minute);
  }
  if (completed.length > 0) {
    const newest = new Date(store.lastWrittenMinute * 1000).toLocaleTimeString();
    console.log(`[historian] persisted ${completed.length} minute(s); newest ${newest}`);
  }
}

// ---------- HTTP API ----------

/** Merge persisted + in-progress buckets, since "today" should include the current partial minute. */
function bucketsInRange(startSec: number, endSec: number): MinuteBucket[] {
  const merged = store.readRange(startSec, endSec);
  for (const bucket of openMinuteBuckets.values()) {
    if (bucket.minute >= startSec && bucket.minute < endSec) merged.push(bucket);
  }
  return merged;
}

function summarize(range: Range, now: Date) {
  const { startSec, endSec } = energyRangeBounds(range, now);
  return summarizeEnergy(bucketsInRange(startSec, endSec), range, now);
}

/**
 * Whether a request's `Origin` is this machine or the LAN — the dashboard is
 * reached both at localhost and, from a phone, at the host's private address, so
 * both have to pass. A missing Origin is a non-browser client (curl, a script),
 * which is not the drive-by case this guards.
 */
function isLocalOrigin(origin?: string): boolean {
  if (!origin) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "::1" || /^127\./.test(hostname)) return true;
  // A name with no dot is a bare LAN hostname; a public site always has one.
  if (!hostname.includes(".")) return true;
  if (/\.(local|internal|home\.arpa|ts\.net)$/.test(hostname)) return true;
  // RFC1918 private ranges.
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  // Tailscale and other CGNAT (100.64.0.0/10), plus link-local and IPv6 ULA.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(hostname);
}

/** Whether a request was addressed to this machine by a loopback name. */
function isLocalHost(host?: string): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const origin = request.headers.origin;
  const local = isLocalOrigin(origin);
  // The recording names every device on the network, its MAC and its traffic, so
  // only a local origin may read it. The dashboard reaches /api through its own
  // server, so nothing legitimate is cross-origin.
  if (local && origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  // The usage list can reset (POST) and delete (DELETE) records — allow both,
  // plus answer the preflight.
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  // A browser honours the missing header above; curl does not, and DELETE
  // /api/clients/totals wipes the usage history outright.
  if (request.method !== "GET" && !local) {
    response.statusCode = 403;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "cross-origin write refused" }));
    return;
  }
  // /api/usage shares the same summary (energy + traffic ride the same buckets)
  if (url.pathname === "/api/energy" || url.pathname === "/api/usage") {
    const rangeParam = url.searchParams.get("range") as Range | null;
    const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : "today";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summarize(range, new Date())));
    return;
  }
  // Full-resolution sample window for chart backfill after a page reload.
  if (url.pathname === "/api/samples") {
    const minutes = Math.min(360, Math.max(1, Number(url.searchParams.get("minutes") ?? 360)));
    const cutoffMs = Date.now() - minutes * 60_000;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        samples: latestSamples
          .filter((sample) => sample.timestampMs >= cutoffMs)
          .map(compactSample),
      }),
    );
    return;
  }
  if (url.pathname === "/api/radio") {
    response.setHeader("Content-Type", "application/json");
    void radioTempSnapshot().then((radio) => {
      response.end(
        JSON.stringify({
          current: radio?.readings ?? [],
          atMs: radio?.atMs ?? null,
        }),
      );
    });
    return;
  }
  // Zero one device's total but keep it listed (a reset, distinct from delete).
  if (url.pathname === "/api/clients/totals/reset" && request.method === "POST") {
    // Keyed by clientId. The UI's `usageKey` sends the clientId for a live device
    // and the MAC for an as-yet-unadopted legacy bucket — both are the store key,
    // so one param covers both without a MAC fallback that would hit inconsistently.
    const client = url.searchParams.get("client");
    const reset = client ? clientTotals.reset(client, Date.now()) : false;
    if (reset) clientTotals.snapshot();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ reset }));
    return;
  }
  // Join two buckets the router issued separate identities to, or record that they
  // are different devices. Both are answers the router's data cannot supply, and
  // both are persisted immediately: an unsaved merge loses a total, an unsaved
  // rejection asks the same question again on the next refresh.
  if (url.pathname === "/api/clients/totals/merge" && request.method === "POST") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const distinct = url.searchParams.get("distinct") === "1";
    const applied =
      from && to
        ? distinct
          ? clientTotals.rejectMerge(from, to)
          : clientTotals.merge(from, to)
        : false;
    if (applied) clientTotals.snapshot();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(distinct ? { rejected: applied } : { merged: applied }));
    return;
  }
  // Per-device monthly usage odometer: read the list, or delete one device's
  // record (?client=) or all of them (no id). Deleting removes the entry; use
  // /reset above to zero a device while keeping it listed.
  if (url.pathname === "/api/clients/totals") {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "DELETE") {
      const client = url.searchParams.get("client");
      if (client) {
        const removed = clientTotals.remove(client);
        clientTotals.snapshot();
        response.end(JSON.stringify({ removed }));
      } else {
        clientTotals.clear();
        clientTotals.snapshot();
        response.end(JSON.stringify({ cleared: true }));
      }
      return;
    }
    response.end(
      JSON.stringify({
        totals: clientTotals.totals(),
        // Rides the list both surfaces already poll, so the prompt needs no
        // request of its own and can never disagree with the rows beside it.
        mergeCandidates: clientTotals.mergeCandidates(Date.now()),
      }),
    );
    return;
  }
  /**
   * The key a recorded row's device is known by now, or undefined to drop it.
   *
   * A keyed row follows any merge or re-anchor the odometer recorded, so a
   * device's history stays with it across the same identity reissue its total
   * does. A row from before per-device keying carries only a MAC: on one that
   * ever wore a single device that is still its own history and it keeps it, but
   * on a MAC that carried a vendor group the row is the group's summed traffic —
   * the bug itself — and belongs to nobody. Memoized, since the legacy lookup
   * scans every bucket.
   */
  const legacyByMac = new Map<string, string | undefined>();
  const resolveRowKey = (row: { key?: string; macAddress: string }): string | undefined => {
    if (row.key !== undefined) return clientTotals.resolveKey(row.key);
    if (!legacyByMac.has(row.macAddress))
      legacyByMac.set(row.macAddress, clientTotals.resolveLegacyMac(row.macAddress));
    return legacyByMac.get(row.macAddress);
  };

  if (url.pathname === "/api/clients") {
    const hours = Math.min(6, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    // One key across history, samples and the odometer: the clientId. The old
    // `mac` filter is gone — a masked MAC names a vendor, not a device, which is
    // what made three bulbs answer to one filter.
    const client = url.searchParams.get("client") ?? undefined;
    // Two tiers, like the dish: `samples` is the raw 1 Hz window behind the
    // 15-minute detail chart, `history` the per-minute rows behind the 6h view.
    // Opt in, because the raw window is far larger than the aggregate.
    const wantSamples = url.searchParams.get("samples") === "1";
    const sinceMs = Number(url.searchParams.get("since") ?? 0) || undefined;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        // `since` callers are tailing the live window and already hold the
        // per-minute rows; re-sending 6h of them every second is pure waste.
        // Rows are fetched unfiltered and the device filter applied after keys
        // resolve, so a merge's history reaches the surviving identity too.
        history: sinceMs
          ? []
          : foldMinuteCollisions(resolveRows(clientStore.history(hours), resolveRowKey, client)),
        ...(wantSamples
          ? {
              samples: resolveRows(clientWindow.samples(undefined, sinceMs), resolveRowKey, client),
            }
          : {}),
        // Monthly odometer, so the device detail can show a real total that
        // survives the reconnects the router's own counter resets on. Asked for
        // explicitly (or implied by a seed request): the sample tail polls at 1 Hz
        // and re-sending every device's total that often is pure waste, so it
        // requests these on a slower beat.
        ...(url.searchParams.get("totals") === "1" || !sinceMs
          ? { totals: clientTotals.totals(client) }
          : {}),
      }),
    );
    return;
  }
  if (url.pathname === "/api/outages") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ events: eventStore.all() }));
    return;
  }
  if (url.pathname === "/api/obstruction/snapshots") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ snapshots: obstructionStore.list() }));
    return;
  }
  if (url.pathname === "/api/thermal") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ episodes: thermalStore.all() }));
    return;
  }
  if (url.pathname === "/api/alerts") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ episodes: alertStore.all() }));
    return;
  }
  // Identifies the device viewing the dashboard so it can flag "This device" in
  // the network list. Returns address(es) to match against the router's client
  // entries. Two cases:
  //   • A remote viewer (phone on the LAN) — the x-forwarded-for first hop (Vite
  //     sets it with xfwd), else the raw socket; that IP is the device.
  //   • A loopback request — the viewer IS this host (dashboard opened on the
  //     machine running the historian, incl. the desktop/Electron case). The
  //     socket IP is useless (::1), so identify by this host's own interfaces,
  //     which also yields the MAC for a stronger match.
  // IPv4-mapped v6 (::ffff:1.2.3.4) is unwrapped to the bare v4 the router lists.
  if (url.pathname === "/api/whoami") {
    const forwarded = request.headers["x-forwarded-for"];
    const firstHop = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    const remote = (firstHop || request.socket.remoteAddress || "").replace(/^::ffff:/i, "");
    const loopback = remote === "" || remote === "::1" || remote === "127.0.0.1";
    let ips: string[];
    let macs: string[];
    if (loopback) {
      const own = Object.values(networkInterfaces())
        .flat()
        .filter((iface) => iface && !iface.internal);
      ips = own.map((iface) => iface!.address);
      macs = [
        ...new Set(
          own.map((iface) => iface!.mac).filter((mac) => mac && mac !== "00:00:00:00:00:00"),
        ),
      ];
    } else {
      ips = [remote];
      macs = [];
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ips, macs }));
    return;
  }
  if (url.pathname === "/api/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, lastWrittenMinute: store.lastWrittenMinute }));
    return;
  }
  response.statusCode = 404;
  response.end("not found");
}

// A single collector must own a data dir: two writing the same files duplicate
// appended rows and clobber each other's snapshots. The lock is keyed to the data
// dir, not the HTTP port — the embedded host never opens a port, so the port never
// guarded it. The pidfile is reclaimed when its recorded owner is gone, so a crash
// (which cannot run the release) does not wedge the next start.
function claimDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(readFileSync(LOCK_FILE, "utf8").trim());
      if (owner && owner !== process.pid && processAlive(owner)) {
        console.error(
          `[historian] another collector (pid ${owner}) already owns ${DATA_DIR} — refusing to start a second writer`,
        );
        process.exit(1);
      }
      // The recorded owner is gone; drop its stale lock and race for it again.
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        // Another starter reclaimed it first; the next attempt finds it held.
      }
    }
  }
  console.error(`[historian] could not claim ${DATA_DIR} — refusing to start`);
  process.exit(1);
}

// Signal 0 probes for the process without delivering anything: ESRCH means it is
// gone, EPERM means it is alive but owned by another user.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function releaseDataDir(): void {
  try {
    if (Number(readFileSync(LOCK_FILE, "utf8").trim()) === process.pid) unlinkSync(LOCK_FILE);
  } catch {
    // Nothing to release, or the lock is no longer ours to remove.
  }
}

claimDataDir();
process.on("exit", releaseDataDir);

// The dev process serves the collector over loopback HTTP. An embedded host (the
// Electron app) sets HISTORIAN_EMBED and calls handleRequest directly instead, so
// there is no open port.
if (process.env.HISTORIAN_EMBED !== "1") {
  createServer((request, response) => {
    // A foreign name pointed at this address would be same-origin here, so the
    // origin rules in handleRequest would not apply to it.
    if (!isLocalHost(request.headers.host)) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
    handleRequest(request, response);
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`[historian] API on http://localhost:${PORT}  (dish: ${DISH_URL})`);
    console.log(`[historian] persisting to ${DATA_FILE}`);
  });
}

loadSampleSnapshot();
recordRecorderGap();
// Seed device totals from history already on disk before the first poll, so a
// fresh install opens with real figures instead of zero. No-op after a restart,
// which reloads the accumulated totals from their own snapshot instead.
seedClientTotals(Date.now());
// Every device poll is scheduled through nonOverlapping, so a slow or silent
// device makes a cycle be skipped rather than run alongside the one before it.
const pollCycle = nonOverlapping(poll);
const pollClientsCycle = nonOverlapping(pollClients);
const pollObstructionCycle = nonOverlapping(pollObstruction);

void pollCycle();
setInterval(() => void pollCycle(), POLL_MS);
setInterval(writeSampleSnapshot, SNAPSHOT_EVERY_MS);
setInterval(() => {
  rotateLogIfLarge(OUT_LOG_FILE);
  rotateLogIfLarge(ERR_LOG_FILE);
}, SNAPSHOT_EVERY_MS);
// Clients run on their own timers: the router keeps no history, so nothing is
// recoverable after the fact. Polling is fast enough to catch each counter step
// as it happens; recording runs at 1 Hz and is what sets chart resolution. One
// call covers every client.
void pollClientsCycle();
setInterval(() => void pollClientsCycle(), CLIENTS_POLL_MS);
// Checked every 5 minutes; the store's isDue() keeps the actual dish call hourly.
void pollObstructionCycle();
setInterval(() => void pollObstructionCycle(), 300_000);
setInterval(recordClients, CLIENTS_RECORD_MS);
setInterval(() => clientWindow.snapshot(), SNAPSHOT_EVERY_MS);
setInterval(() => clientTotals.snapshot(), SNAPSHOT_EVERY_MS);
setInterval(() => {
  const folded = store.compact();
  if (folded > 0)
    console.log(`[historian] folded ${folded} minute(s) from past years into monthly summaries`);
}, COMPACT_EVERY_MS);
// The per-device log keeps only six hours, so it cannot wait for the daily sweep.
setInterval(() => {
  const dropped = clientStore.compact();
  if (dropped > 0) console.log(`[historian] compacted client log, dropped ${dropped} old row(s)`);
  // Drop usage records for devices unseen since before last month, on the same
  // hourly sweep, then persist so the trim survives a restart.
  const totalsDropped = clientTotals.compact(Date.now());
  if (totalsDropped > 0) {
    clientTotals.snapshot();
    console.log(`[historian] dropped ${totalsDropped} stale device total(s)`);
  }
}, 3_600_000);
process.on("SIGTERM", () => {
  writeSampleSnapshot();
  clientWindow.snapshot();
  clientTotals.snapshot();
  process.exit(0);
});
