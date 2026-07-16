// Always-on energy collector + HTTP API.
//
// Polls the dish's history ring buffer directly (reusing the frontend's
// grpc-web transport and decoder so the two never drift), folds new per-second
// power readings into per-minute energy buckets, and persists completed minutes
// to an NDJSON log. Serves day/week/month energy totals over /api/energy.
//
// Energy is integrated ONLY over minutes actually sampled — collector downtime
// (sleep, restart, Wi-Fi drop) shows up as reduced coverage, never as invented
// kWh. Short gaps (≤15 min) are backfilled losslessly from the ring buffer on
// the next poll.
//
// Run: npm run collector   (foreground; see server/README for always-on setup)

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "../src/lib/grpcWeb.ts";
import {
  decodeHistoryWindow,
  decodeOutageEvents,
  TelemetryAccumulator,
  type TelemetrySample,
} from "../src/lib/telemetry.ts";
import { EnergyStore, foldSamplesToMinutes, type MinuteBucket } from "./energyStore.mts";
import { ThermalStore } from "./thermalStore.mts";
import { EventStore } from "./eventStore.mts";
import { RadioStore, type RadioReading } from "./radioStore.mts";

const DISH_URL =
  process.env.DISH_URL ?? "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
const PROTOSET_PATH = resolve("public/dish.protoset");
const DATA_FILE = resolve("server/data/energy.ndjson");
const SAMPLES_SNAPSHOT_FILE = resolve("server/data/samples.json");
const THERMAL_FILE = resolve("server/data/thermal.ndjson");
const EVENTS_FILE = resolve("server/data/events.ndjson");
const RADIO_FILE = resolve("server/data/radio.ndjson");
const PORT = Number(process.env.COLLECTOR_PORT ?? 8088);
const POLL_MS = 5_000;
const GET_HISTORY_FIELD = 1007;
const GET_STATUS_FIELD = 1004;
const GET_RADIO_STATS_FIELD = 1036;

/**
 * The router answers get_radio_stats on its own endpoint; the dish answers it
 * Unimplemented. This is the only live temperature either device will give up.
 */
const ROUTER_URL = process.env.ROUTER_URL ?? "http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle";

/**
 * Thermal flags on get_status → alerts. The dish has no temperature reading to
 * go with them — the numeric sensors live on TransceiverGetStatus, which this
 * firmware answers with Unimplemented — so these booleans are the whole signal,
 * and they only exist while they are set. Nobody records them but us.
 */
const THERMAL_ALERT_KEYS = ["thermalThrottle", "thermalShutdown", "powerSupplyThermalThrottle"];
const SAMPLE_WINDOW_SECONDS = 6 * 3_600;
const SNAPSHOT_EVERY_MS = 60_000;

const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(PROTOSET_PATH)));
const responseSchema = registry.getMessage("SpaceX.API.Device.Response");
if (!responseSchema) throw new Error("SpaceX.API.Device.Response missing from protoset");

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

const store = new EnergyStore(DATA_FILE);
// Compaction also runs on construction; repeat daily for a collector that stays
// up for months at a stretch.
const COMPACT_EVERY_MS = 24 * 3_600_000;
const thermalStore = new ThermalStore(THERMAL_FILE);
const eventStore = new EventStore(EVENTS_FILE);
const radioStore = new RadioStore(RADIO_FILE);
let latestRadio: { readings: RadioReading[]; atMs: number } | null = null;
// Minutes seen but not yet completed (the in-progress minute, replaced each poll
// with the authoritative recompute from the ring buffer).
const pending = new Map<number, MinuteBucket>();

// Rolling full-resolution window served to the frontend so page reloads (and
// collector restarts, via the snapshot file) never reset the charts.
const sampleWindow = new TelemetryAccumulator(SAMPLE_WINDOW_SECONDS);

function loadSampleSnapshot(): void {
  if (!existsSync(SAMPLES_SNAPSHOT_FILE)) return;
  try {
    const persisted = JSON.parse(readFileSync(SAMPLES_SNAPSHOT_FILE, "utf8")) as TelemetrySample[];
    const cutoffMs = Date.now() - SAMPLE_WINDOW_SECONDS * 1000;
    latestSamples = sampleWindow.seed(persisted.filter((sample) => sample.timestampMs >= cutoffMs));
    console.log(`[collector] restored ${latestSamples.length} samples from snapshot`);
  } catch (error) {
    console.warn(`[collector] snapshot unreadable, starting fresh: ${(error as Error).message}`);
  }
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
    console.warn(`[collector] snapshot write failed: ${(error as Error).message}`);
  }
}

/**
 * Record thermal alert edges. An unreachable dish means no reading, not a
 * cleared alert, so a failed poll leaves open episodes open.
 */
async function pollThermal(): Promise<void> {
  let alerts: Record<string, boolean>;
  try {
    alerts = await getStatusAlerts();
  } catch {
    return; // the history poll already logs dish-unreachable
  }
  const now = Date.now();
  for (const alertKey of THERMAL_ALERT_KEYS) {
    const isActive = alerts[alertKey] === true;
    const wasActive = thermalStore.isOpen(alertKey);
    if (isActive && !wasActive) {
      thermalStore.open(alertKey, now);
      console.log(`[collector] thermal alert ON: ${alertKey}`);
    }
    if (!isActive && wasActive) {
      thermalStore.close(alertKey, now);
      console.log(`[collector] thermal alert cleared: ${alertKey}`);
    }
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

async function poll(): Promise<void> {
  await pollThermal();
  await pollRadio();

  let history: Awaited<ReturnType<typeof getHistory>>;
  try {
    history = await getHistory();
  } catch (error) {
    console.warn(`[collector] dish unreachable: ${(error as Error).message}`);
    return;
  }

  // The dish's event list rolls and resets on reboot; fold each poll's view
  // into the durable log while we still have it.
  const newEvents = eventStore.upsert(decodeOutageEvents(history));
  if (newEvents > 0) console.log(`[collector] recorded ${newEvents} event(s) from the dish log`);

  const now = Date.now();
  latestSamples = sampleWindow.ingest(history, now);
  const { samples } = decodeHistoryWindow(history, now);
  const perMinute = foldSamplesToMinutes(samples);

  // Replace (not accumulate) so re-seeing a minute across overlapping polls is idempotent.
  for (const [minute, bucket] of perMinute) {
    if (minute > store.lastWrittenMinute) pending.set(minute, bucket);
  }

  const currentMinute = Math.floor(now / 60_000) * 60;
  const completed = [...pending.keys()].filter((minute) => minute < currentMinute).sort((a, b) => a - b);
  for (const minute of completed) {
    store.append(pending.get(minute)!);
    pending.delete(minute);
  }
  if (completed.length > 0) {
    const newest = new Date(store.lastWrittenMinute * 1000).toLocaleTimeString();
    console.log(`[collector] persisted ${completed.length} minute(s); newest ${newest}`);
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

/** Local first-of-month 00:00 `monthsBack` months ago, epoch seconds. */
function startOfMonthSec(now: Date, monthsBack: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  date.setMonth(date.getMonth() - monthsBack);
  return Math.floor(date.getTime() / 1000);
}

const RANGE_SPECS: Record<Range, RangeSpec> = {
  "1h": { startSec: (now) => hoursBackSec(now, 1), group: "fixed", fixedSec: 300 }, // 5-min bars
  "6h": { startSec: (now) => hoursBackSec(now, 6), group: "fixed", fixedSec: 1_800 }, // 30-min bars
  "12h": { startSec: (now) => hoursBackSec(now, 12), group: "fixed", fixedSec: 3_600 }, // hourly bars
  today: { startSec: (now) => startOfDaySec(now, 0), group: "fixed", fixedSec: 3_600 }, // hourly, since midnight
  day: { startSec: (now) => startOfDaySec(now, 13), group: "calendarDay" }, // last 14 individual days
  week: { startSec: (now) => startOfWeekSec(now, 11), group: "calendarWeek" }, // last 12 individual weeks
  month: { startSec: (now) => startOfMonthSec(now, 11), group: "calendarMonth" }, // last 12 individual months
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
 * hour the collector missed vanishes and the bars either side sit shoulder to
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

  const groups = new Map<number, { wattSeconds: number; samples: number; dlBits: number; ulBits: number }>();
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

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  response.setHeader("Access-Control-Allow-Origin", "*");
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
        samples: latestSamples.filter((sample) => sample.timestampMs >= cutoffMs).map(compactSample),
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
  if (url.pathname === "/api/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, lastWrittenMinute: store.lastWrittenMinute }));
    return;
  }
  response.statusCode = 404;
  response.end("not found");
});

server.listen(PORT, () => {
  console.log(`[collector] API on http://localhost:${PORT}  (dish: ${DISH_URL})`);
  console.log(`[collector] persisting to ${DATA_FILE}`);
});

loadSampleSnapshot();
void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(writeSampleSnapshot, SNAPSHOT_EVERY_MS);
setInterval(() => {
  const dropped = store.compact();
  if (dropped > 0) console.log(`[collector] compacted energy log, dropped ${dropped} old minute(s)`);
  const radioDropped = radioStore.compact();
  if (radioDropped > 0) console.log(`[collector] compacted radio log, dropped ${radioDropped} old row(s)`);
}, COMPACT_EVERY_MS);
process.on("SIGTERM", () => {
  writeSampleSnapshot();
  process.exit(0);
});
