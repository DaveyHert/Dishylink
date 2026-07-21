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
// Run: npm run historian   (foreground; see server/README for always-on setup)

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { createFileRegistry, fromBinary, toJson, type DescMessage } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "../src/lib/grpcWeb.ts";
import {
  decodeHistoryWindow,
  decodeOutageEvents,
  decodeWifiHistoryEvents,
  readRouterLatencyMs,
  readRouterPingSuccessPercent,
  TelemetryAccumulator,
  type TelemetrySample,
} from "../src/lib/telemetry.ts";
import { EnergyStore, foldSamplesToMinutes, type MinuteBucket } from "./energyStore.mts";
import { ThermalStore } from "./thermalStore.mts";
import { EventStore } from "./eventStore.mts";
import { RadioStore, type RadioReading } from "./radioStore.mts";
import { ClientStore, type ClientReading } from "./clientStore.mts";
import { ClientWindow } from "./clientWindow.mts";
import { ClientTotalsStore } from "./clientTotals.mts";
import { ThroughputTracker } from "../src/lib/throughputTracker.ts";
import { AlertStore } from "./alertStore.mts";

const DISH_URL =
  process.env.DISH_URL ?? "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
const PROTOSET_PATH = resolve("public/dish.protoset");
const DATA_FILE = resolve("server/data/energy.ndjson");
const SAMPLES_SNAPSHOT_FILE = resolve("server/data/samples.json");
const THERMAL_FILE = resolve("server/data/thermal.ndjson");
const EVENTS_FILE = resolve("server/data/events.ndjson");
const RADIO_FILE = resolve("server/data/radio.ndjson");
const CLIENTS_FILE = resolve("server/data/clients.ndjson");
const CLIENT_SAMPLES_FILE = resolve("server/data/client-samples.json");
const CLIENT_TOTALS_FILE = resolve("server/data/client-totals.json");
const ALERTS_FILE = resolve("server/data/alerts.ndjson");
const PORT = Number(process.env.HISTORIAN_PORT ?? 8088);
const POLL_MS = 5_000;
/**
 * Faster than the router's ~1005 ms stats refresh, so every counter step is
 * caught as an edge rather than sampled on our clock and aliased. See
 * `src/lib/throughputTracker.ts` for why the edge is what gets measured.
 *
 * 200 ms (five polls per step) is the comfortable margin. Restored 2026-07-21
 * as a deliberate trial: the 2026-07-20 watchdog reboots were traced to
 * get_ping, not this poll, and running at full rate is the way to prove the
 * router stays healthy under it. If SOFTWARE_WATCHDOG reboots return, drop to
 * 500 ms — two polls per step still catches every edge (one slow reply can
 * land an edge a step late, briefly smearing a per-device reading) at 2 req/s
 * instead of 5, the chattiest thing we send the router.
 */
const CLIENTS_POLL_MS = 200;
/** Recording cadence. The rates are already exact per refresh interval, so this
 *  sets how densely they are stored, independent of how often they are read. */
const CLIENTS_RECORD_MS = 1_000;
const GET_HISTORY_FIELD = 1007;
const GET_STATUS_FIELD = 1004;
const GET_RADIO_STATS_FIELD = 1036;
const WIFI_GET_CLIENTS_FIELD = 3002;

/**
 * The router answers get_radio_stats on its own endpoint; the dish answers it
 * Unimplemented. This is the only live temperature either device will give up.
 */
const ROUTER_URL =
  process.env.ROUTER_URL ?? "http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle";

/**
 * Thermal flags on get_status → alerts. The dish has no temperature reading to
 * go with them — the numeric sensors live on TransceiverGetStatus, which this
 * firmware answers with Unimplemented — so these booleans are the whole signal,
 * and they only exist while they are set. Nobody records them but us.
 */
const THERMAL_ALERT_KEYS = ["thermalThrottle", "thermalShutdown", "powerSupplyThermalThrottle"];
const SAMPLE_WINDOW_SECONDS = 6 * 3_600;
const SNAPSHOT_EVERY_MS = 60_000;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getHistory(): Promise<any> {
  const bytes = await grpcWebUnaryCall(DISH_URL, requestBytes(GET_HISTORY_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
    dishGetHistory?: unknown;
  };
  return json.dishGetHistory ?? {};
}

// get_history (1007) is a shared request: sent to the router it answers with
// wifi_get_history — the router's own event log (power cycles, reboots, software
// updates, client band-switching, …), the same UXEvent shape as the dish's.
async function getWifiHistory(): Promise<{ eventLog?: { events?: unknown[] } }> {
  const bytes = await grpcWebUnaryCall(ROUTER_URL, requestBytes(GET_HISTORY_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
    wifiGetHistory?: { eventLog?: { events?: unknown[] } };
  };
  return json.wifiGetHistory ?? {};
}

/**
 * `toJson` omits false fields, so an alert key is absent unless it is true —
 * `=== true` is the check, and absence means clear.
 */
async function getStatusAlerts(): Promise<Record<string, boolean>> {
  const bytes = await grpcWebUnaryCall(DISH_URL, requestBytes(GET_STATUS_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
    dishGetStatus?: { alerts?: Record<string, boolean> };
  };
  return json.dishGetStatus?.alerts ?? {};
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
  const bytes = await grpcWebUnaryCall(ROUTER_URL, requestBytes(GET_STATUS_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
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
async function getRadioReadings(): Promise<RadioReading[]> {
  const bytes = await grpcWebUnaryCall(ROUTER_URL, requestBytes(GET_RADIO_STATS_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
    getRadioStats?: {
      radioStats?: Array<{
        band?: string;
        thermalStatus?: { temp?: number; temp2?: number; dutyCycle?: number };
      }>;
    };
  };
  const readings: RadioReading[] = [];
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

async function getClientReadings(): Promise<ClientReading[]> {
  const bytes = await grpcWebUnaryCall(ROUTER_URL, requestBytes(WIFI_GET_CLIENTS_FIELD));
  const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
    wifiGetClients?: {
      clients?: Array<{
        macAddress?: string;
        name?: string;
        givenName?: string;
        role?: string;
        rxStats?: WireStats;
        txStats?: WireStats;
      }>;
    };
  };
  const readings: ClientReading[] = [];
  const nowMs = Date.now();
  for (const client of json.wifiGetClients?.clients ?? []) {
    // The router itself reports empty stats — it is the network, not a client of it.
    if (!client.macAddress || (client.role && client.role !== "CLIENT")) continue;

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
        client.macAddress,
        counters.rxBytes,
        counters.txBytes,
        nowMs,
        client.givenName ?? client.name,
      );
    }

    // 15s, not 1m: the shorter window is closer to the truth whenever a delta is
    // unavailable, and txStats has no 1m field at all — preferring it would leave
    // download smoothed over 60s and upload over 15s on the same chart.
    const rates = clientThroughput.rates(client.macAddress, counters, nowMs, {
      downMbps: finiteMbps(client.rxStats?.throughputMbpsLast15sAvg) ?? 0,
      upMbps: finiteMbps(client.txStats?.throughputMbpsLast15sAvg) ?? 0,
    });

    readings.push({
      macAddress: client.macAddress,
      name: client.givenName ?? client.name,
      downMbps: rates.downMbps,
      upMbps: rates.upMbps,
      rxBytes: counters?.rxBytes ?? 0,
      txBytes: counters?.txBytes ?? 0,
    });
  }
  clientThroughput.retain(readings.map((reading) => reading.macAddress));
  return readings;
}

const store = new EnergyStore(DATA_FILE);
// Compaction also runs on construction; repeat daily for a historian that stays
// up for months at a stretch.
const COMPACT_EVERY_MS = 24 * 3_600_000;
const thermalStore = new ThermalStore(THERMAL_FILE);
const eventStore = new EventStore(EVENTS_FILE);
const radioStore = new RadioStore(RADIO_FILE);
const clientStore = new ClientStore(CLIENTS_FILE);
const clientWindow = new ClientWindow(CLIENT_SAMPLES_FILE);
const alertStore = new AlertStore(ALERTS_FILE);
let latestRadio: { readings: RadioReading[]; atMs: number } | null = null;
// Minutes seen but not yet completed (the in-progress minute, replaced each poll
// with the authoritative recompute from the ring buffer).
const pending = new Map<number, MinuteBucket>();

// Rolling full-resolution window served to the frontend so page reloads (and
// historian restarts, via the snapshot file) never reset the charts.
const sampleWindow = new TelemetryAccumulator(SAMPLE_WINDOW_SECONDS);

function loadSampleSnapshot(): void {
  if (!existsSync(SAMPLES_SNAPSHOT_FILE)) return;
  try {
    const persisted = JSON.parse(readFileSync(SAMPLES_SNAPSHOT_FILE, "utf8")) as TelemetrySample[];
    const cutoffMs = Date.now() - SAMPLE_WINDOW_SECONDS * 1000;
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
 * rather than implying "nothing happened". (2026-07-20: the recorder was off
 * 12:45–16:15 during diagnosis and that window's alerts silently vanished.)
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
 * Record alert edges from both devices. An unreachable device means no reading,
 * not a cleared alert, so a failed fetch leaves that device's open episodes open
 * and never touches the other's.
 *
 * The dish's status is fetched once and fed to two stores: thermalStore (the
 * three thermal keys, kept for the event log) and alertStore (every key). The
 * duplication for thermal keys is deliberate — the event log reads thermalStore.
 */
async function pollAlerts(): Promise<void> {
  const now = Date.now();
  try {
    const dishAlerts = await getStatusAlerts();
    for (const alertKey of THERMAL_ALERT_KEYS) {
      const isActive = dishAlerts[alertKey] === true;
      const wasActive = thermalStore.isOpen(alertKey);
      if (isActive && !wasActive) {
        thermalStore.open(alertKey, now);
        console.log(`[historian] thermal alert ON: ${alertKey}`);
      }
      if (!isActive && wasActive) {
        thermalStore.close(alertKey, now);
        console.log(`[historian] thermal alert cleared: ${alertKey}`);
      }
    }
    alertStore.ingest("dish", dishAlerts, now);
    // The dish answered, so it is reachable. Recorded as an alert in its own
    // right: the 20 keys above only exist inside a reply, so the one condition
    // that silences them all can never be one of them.
    alertStore.close("system", "dishUnreachable", now);
  } catch {
    // No reply. Leave the dish's own episodes open — an unreachable dish means
    // no reading, not a cleared alert — and record the unreachability itself so
    // it survives in history instead of only being a console warning.
    alertStore.open("system", "dishUnreachable", now);
  }
  try {
    // One status reply, two consumers: the alert set, and the ping the sample
    // stamping picks up below.
    const routerStatus = await getRouterStatus();
    latestRouterLatencyMs = readRouterLatencyMs(routerStatus.popPingLatencyMs);
    latestRouterPingSuccessPercent = readRouterPingSuccessPercent(routerStatus.popPingDropRate5m);
    const routerNow = Date.now();
    alertStore.ingest("router", routerStatus.alerts ?? {}, routerNow);
    alertStore.close("system", "routerUnreachable", routerNow);
  } catch {
    // router unreachable (or bypass mode) — leave its open episodes open
    latestRouterLatencyMs = null;
    latestRouterPingSuccessPercent = null;
    alertStore.open("system", "routerUnreachable", Date.now());
  }
}

/**
 * Record the router's radio temperatures. The router is a separate device on a
 * separate address: it can be unreachable while the dish is fine, so its
 * failures stay quiet rather than reading as a dish problem.
 */
async function pollRadio(): Promise<void> {
  try {
    const readings = await getRadioReadings();
    if (readings.length === 0) return;
    latestRadio = { readings, atMs: Date.now() };
    radioStore.ingest(readings, Date.now());
  } catch {
    // router unreachable (or not a Starlink router) — leave the last reading be
  }
}

/**
 * Same contract as pollRadio: the router is a separate box and its failures
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
let clientPollInFlight = false;
/** Newest rates from the fast poll, waiting to be recorded. */
let latestClientReadings: ClientReading[] = [];
async function pollClients(): Promise<void> {
  // A router that stops answering must not stack a request every poll until the
  // connection budget starves the dish poll — the tighter interval makes this
  // guard matter more, not less.
  if (clientPollInFlight) return;
  clientPollInFlight = true;
  try {
    const readings = await getClientReadings();
    if (readings.length > 0) latestClientReadings = readings;
  } catch {
    // router unreachable (or bypass mode) — keep what we have
  } finally {
    clientPollInFlight = false;
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
    if (clientTotals.has(mac)) continue;
    // Seed at the minute the device was last recorded, not now: most of this
    // history belongs to devices that are currently offline, and stamping them
    // with `nowMs` would have the list report every one of them as active.
    clientTotals.seed(mac, Math.round(agg.rx), Math.round(agg.tx), agg.lastMs, agg.name);
    seeded++;
  }
  if (seeded > 0) console.log(`[historian] seeded ${seeded} device total(s) from recorded history`);
}

async function poll(): Promise<void> {
  await pollAlerts();
  await pollRadio();

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
  latestSamples = sampleWindow.ingest(history, now, {
    latencyMs: latestRouterLatencyMs,
    pingSuccessPercent: latestRouterPingSuccessPercent,
  });
  const { samples } = decodeHistoryWindow(history, now);
  const perMinute = foldSamplesToMinutes(samples);

  // Replace (not accumulate) so re-seeing a minute across overlapping polls is idempotent.
  for (const [minute, bucket] of perMinute) {
    if (minute > store.lastWrittenMinute) pending.set(minute, bucket);
  }

  const currentMinute = Math.floor(now / 60_000) * 60;
  const completed = [...pending.keys()]
    .filter((minute) => minute < currentMinute)
    .sort((a, b) => a - b);
  for (const minute of completed) {
    store.append(pending.get(minute)!);
    pending.delete(minute);
  }
  if (completed.length > 0) {
    const newest = new Date(store.lastWrittenMinute * 1000).toLocaleTimeString();
    console.log(`[historian] persisted ${completed.length} minute(s); newest ${newest}`);
  }
}

// ---------- HTTP API ----------

type Range = "1h" | "6h" | "12h" | "today" | "day" | "week" | "month";

const RANGES: Range[] = ["1h", "6h", "12h", "today", "day", "week", "month"];

/** How a range's minute buckets are grouped into bars. */
type GroupUnit = "fixed" | "calendarDay" | "calendarWeek" | "calendarMonth";

interface RangeSpec {
  startSec: (now: Date) => number;
  group: GroupUnit;
  /** Bar width in seconds, only for `group: "fixed"`. */
  fixedSec?: number;
}

function hoursBackSec(now: Date, hours: number): number {
  return Math.floor(now.getTime() / 1000) - hours * 3_600;
}

/** Local midnight `daysBack` days ago (system timezone), epoch seconds. */
function startOfDaySec(now: Date, daysBack: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysBack);
  return Math.floor(date.getTime() / 1000);
}

/** Local Monday-00:00 of the week `weeksBack` weeks ago, epoch seconds. */
function startOfWeekSec(now: Date, weeksBack: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const mondayOffset = (date.getDay() + 6) % 7; // Sun=6 … Mon=0
  date.setDate(date.getDate() - mondayOffset - weeksBack * 7);
  return Math.floor(date.getTime() / 1000);
}

/** Local start of the current calendar year, epoch seconds. */
function startOfYearSec(now: Date): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setMonth(0, 1);
  return Math.floor(date.getTime() / 1000);
}

const RANGE_SPECS: Record<Range, RangeSpec> = {
  "1h": { startSec: (now) => hoursBackSec(now, 1), group: "fixed", fixedSec: 300 }, // 5-min bars
  "6h": { startSec: (now) => hoursBackSec(now, 6), group: "fixed", fixedSec: 1_800 }, // 30-min bars
  "12h": { startSec: (now) => hoursBackSec(now, 12), group: "fixed", fixedSec: 3_600 }, // hourly bars
  today: { startSec: (now) => startOfDaySec(now, 0), group: "fixed", fixedSec: 3_600 }, // hourly, since midnight
  day: { startSec: (now) => startOfDaySec(now, 13), group: "calendarDay" }, // last 14 individual days
  week: { startSec: (now) => startOfWeekSec(now, 11), group: "calendarWeek" }, // last 12 individual weeks
  // Calendar year, as Starlink's own usage page does it: Jan–Dec of this year,
  // not a window straddling into last year. Older months live on as one-row
  // summaries in the store rather than as minutes nothing can draw.
  month: { startSec: (now) => startOfYearSec(now), group: "calendarMonth" },
};

/** Bar this minute belongs to: a fixed slice, or the local calendar day/week/month start. */
function groupKeyOf(minuteSec: number, spec: RangeSpec): number {
  if (spec.group === "fixed") return Math.floor(minuteSec / spec.fixedSec!) * spec.fixedSec!;
  const date = new Date(minuteSec * 1000);
  date.setHours(0, 0, 0, 0);
  if (spec.group === "calendarWeek") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  else if (spec.group === "calendarMonth") date.setDate(1);
  return Math.floor(date.getTime() / 1000);
}

/**
 * Every bar slot in the range, including ones nothing was recorded for.
 * Emitting only the slots that have data lets the survivors close ranks, so an
 * hour the historian missed vanishes and the bars either side sit shoulder to
 * shoulder as though no time passed between them.
 */
function groupKeysInRange(startSec: number, endSec: number, spec: RangeSpec): number[] {
  const keys: number[] = [];
  if (spec.group === "fixed") {
    const first = Math.floor(startSec / spec.fixedSec!) * spec.fixedSec!;
    for (let key = first; key <= endSec; key += spec.fixedSec!) keys.push(key);
    return keys;
  }
  const cursor = new Date(startSec * 1000);
  cursor.setHours(0, 0, 0, 0);
  if (spec.group === "calendarWeek") cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  else if (spec.group === "calendarMonth") cursor.setDate(1);
  while (Math.floor(cursor.getTime() / 1000) <= endSec) {
    keys.push(Math.floor(cursor.getTime() / 1000));
    if (spec.group === "calendarDay") cursor.setDate(cursor.getDate() + 1);
    else if (spec.group === "calendarWeek") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

/** Where the slot after this one starts — the end of this slot's span. */
function nextGroupKey(key: number, spec: RangeSpec): number {
  if (spec.group === "fixed") return key + spec.fixedSec!;
  const cursor = new Date(key * 1000);
  if (spec.group === "calendarDay") cursor.setDate(cursor.getDate() + 1);
  else if (spec.group === "calendarWeek") cursor.setDate(cursor.getDate() + 7);
  else cursor.setMonth(cursor.getMonth() + 1);
  return Math.floor(cursor.getTime() / 1000);
}

/** Merge persisted + in-progress buckets, since "today" should include the current partial minute. */
function bucketsInRange(startSec: number, endSec: number): MinuteBucket[] {
  const merged = store.readRange(startSec, endSec);
  for (const bucket of pending.values()) {
    if (bucket.minute >= startSec && bucket.minute < endSec) merged.push(bucket);
  }
  return merged;
}

function summarize(range: Range, now: Date) {
  const spec = RANGE_SPECS[range];
  const startSec = spec.startSec(now);
  const endSec = Math.floor(now.getTime() / 1000);
  const buckets = bucketsInRange(startSec, endSec);

  const groups = new Map<
    number,
    { wattSeconds: number; samples: number; dlBits: number; ulBits: number }
  >();
  let totalWattSeconds = 0;
  let sampledSeconds = 0;
  let totalDlBits = 0;
  let totalUlBits = 0;
  for (const bucket of buckets) {
    const key = groupKeyOf(bucket.minute, spec);
    const group = groups.get(key) ?? { wattSeconds: 0, samples: 0, dlBits: 0, ulBits: 0 };
    group.wattSeconds += bucket.wattSeconds;
    group.samples += bucket.samples;
    group.dlBits += bucket.dlBits ?? 0;
    group.ulBits += bucket.ulBits ?? 0;
    groups.set(key, group);
    totalWattSeconds += bucket.wattSeconds;
    sampledSeconds += bucket.samples;
    totalDlBits += bucket.dlBits ?? 0;
    totalUlBits += bucket.ulBits ?? 0;
  }

  const BITS_PER_GB = 8e9;
  const expectedSeconds = Math.max(1, endSec - startSec);
  return {
    range,
    totalKWh: totalWattSeconds / 3_600_000,
    totalDownGB: totalDlBits / BITS_PER_GB,
    totalUpGB: totalUlBits / BITS_PER_GB,
    coverage: {
      sampledSeconds,
      expectedSeconds,
      fraction: Math.min(1, sampledSeconds / expectedSeconds),
    },
    buckets: groupKeysInRange(startSec, endSec, spec).map((t) => {
      // How much of this slot the window actually asks about: the first and
      // last slots are clipped by the range, and the last one is still running.
      const expectedSeconds = Math.max(
        0,
        Math.min(nextGroupKey(t, spec), endSec) - Math.max(t, startSec),
      );
      const group = groups.get(t);
      // Nothing recorded is not the same claim as nothing used — null so the
      // bar can be left out rather than drawn at zero.
      if (!group) {
        return { t, kWh: null, downGB: null, upGB: null, sampledSeconds: 0, expectedSeconds };
      }
      return {
        t,
        kWh: group.wattSeconds / 3_600_000,
        downGB: group.dlBits / BITS_PER_GB,
        upGB: group.ulBits / BITS_PER_GB,
        sampledSeconds: group.samples,
        expectedSeconds,
      };
    }),
  };
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

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  response.setHeader("Access-Control-Allow-Origin", "*");
  // The usage list can reset (POST) and delete (DELETE) records — allow both,
  // plus answer the preflight.
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  // Reads stay open to anything. Writes do not: a wildcard policy in front of
  // DELETE /api/clients/totals would let any page the user happens to visit wipe
  // their usage history from across the internet. Only a page served from this
  // machine or the LAN may mutate.
  if (request.method !== "GET" && !isLocalOrigin(request.headers.origin)) {
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
    const hours = Math.min(24, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        current: latestRadio?.readings ?? [],
        atMs: latestRadio?.atMs ?? null,
        history: radioStore.history(hours),
      }),
    );
    return;
  }
  // Zero one device's total but keep it listed (a reset, distinct from delete).
  if (url.pathname === "/api/clients/totals/reset" && request.method === "POST") {
    const mac = url.searchParams.get("mac");
    const reset = mac ? clientTotals.reset(mac, Date.now()) : false;
    if (reset) clientTotals.snapshot();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ reset }));
    return;
  }
  // Per-device monthly usage odometer: read the list, or delete one device's
  // record (?mac=) or all of them (no mac). Deleting removes the entry; use
  // /reset above to zero a device while keeping it listed.
  if (url.pathname === "/api/clients/totals") {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "DELETE") {
      const mac = url.searchParams.get("mac");
      if (mac) {
        const removed = clientTotals.remove(mac);
        clientTotals.snapshot();
        response.end(JSON.stringify({ removed }));
      } else {
        clientTotals.clear();
        clientTotals.snapshot();
        response.end(JSON.stringify({ cleared: true }));
      }
      return;
    }
    response.end(JSON.stringify({ totals: clientTotals.totals() }));
    return;
  }
  if (url.pathname === "/api/clients") {
    const hours = Math.min(6, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    const mac = url.searchParams.get("mac") ?? undefined;
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
        history: sinceMs ? [] : clientStore.history(hours, mac),
        ...(wantSamples ? { samples: clientWindow.samples(mac, sinceMs) } : {}),
        // Monthly odometer, so the device detail can show a real total that
        // survives the reconnects the router's own counter resets on. Asked for
        // explicitly (or implied by a seed request): the sample tail polls at 1 Hz
        // and re-sending every device's total that often is pure waste, so it
        // requests these on a slower beat.
        ...(url.searchParams.get("totals") === "1" || !sinceMs
          ? { totals: clientTotals.totals(mac) }
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
});

server.listen(PORT, () => {
  console.log(`[historian] API on http://localhost:${PORT}  (dish: ${DISH_URL})`);
  console.log(`[historian] persisting to ${DATA_FILE}`);
});

loadSampleSnapshot();
recordRecorderGap();
// Seed device totals from history already on disk before the first poll, so a
// fresh install opens with real figures instead of zero. No-op after a restart,
// which reloads the accumulated totals from their own snapshot instead.
seedClientTotals(Date.now());
void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(writeSampleSnapshot, SNAPSHOT_EVERY_MS);
// Clients run on their own timers: the router keeps no history, so nothing is
// recoverable after the fact. Polling is fast enough to catch each counter step
// as it happens; recording runs at 1 Hz and is what sets chart resolution. One
// call covers every client.
void pollClients();
setInterval(() => void pollClients(), CLIENTS_POLL_MS);
setInterval(recordClients, CLIENTS_RECORD_MS);
setInterval(() => clientWindow.snapshot(), SNAPSHOT_EVERY_MS);
setInterval(() => clientTotals.snapshot(), SNAPSHOT_EVERY_MS);
setInterval(() => {
  const folded = store.compact();
  if (folded > 0)
    console.log(`[historian] folded ${folded} minute(s) from past years into monthly summaries`);
  const radioDropped = radioStore.compact();
  if (radioDropped > 0)
    console.log(`[historian] compacted radio log, dropped ${radioDropped} old row(s)`);
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
