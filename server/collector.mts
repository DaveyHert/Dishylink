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

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "../src/lib/grpcWeb.ts";
import { decodeHistoryWindow } from "../src/lib/telemetry.ts";
import { EnergyStore, foldSamplesToMinutes, type MinuteBucket } from "./energyStore.mts";

const DISH_URL =
  process.env.DISH_URL ?? "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
const PROTOSET_PATH = resolve("public/dish.protoset");
const DATA_FILE = resolve("server/data/energy.ndjson");
const PORT = Number(process.env.COLLECTOR_PORT ?? 8088);
const POLL_MS = 5_000;
const GET_HISTORY_FIELD = 1007;

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

const store = new EnergyStore(DATA_FILE);
// Minutes seen but not yet completed (the in-progress minute, replaced each poll
// with the authoritative recompute from the ring buffer).
const pending = new Map<number, MinuteBucket>();

async function poll(): Promise<void> {
  let history: Awaited<ReturnType<typeof getHistory>>;
  try {
    history = await getHistory();
  } catch (error) {
    console.warn(`[collector] dish unreachable: ${(error as Error).message}`);
    return;
  }

  const now = Date.now();
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

  const groups = new Map<number, { wattSeconds: number; samples: number }>();
  let totalWattSeconds = 0;
  let sampledSeconds = 0;
  for (const bucket of buckets) {
    const key = groupKeyOf(bucket.minute, spec);
    const group = groups.get(key) ?? { wattSeconds: 0, samples: 0 };
    group.wattSeconds += bucket.wattSeconds;
    group.samples += bucket.samples;
    groups.set(key, group);
    totalWattSeconds += bucket.wattSeconds;
    sampledSeconds += bucket.samples;
  }

  const expectedSeconds = Math.max(1, endSec - startSec);
  return {
    range,
    totalKWh: totalWattSeconds / 3_600_000,
    coverage: {
      sampledSeconds,
      expectedSeconds,
      fraction: Math.min(1, sampledSeconds / expectedSeconds),
    },
    buckets: [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, group]) => ({ t, kWh: group.wattSeconds / 3_600_000, sampledSeconds: group.samples })),
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  response.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/api/energy") {
    const rangeParam = url.searchParams.get("range") as Range | null;
    const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : "today";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summarize(range, new Date())));
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

void poll();
setInterval(() => void poll(), POLL_MS);
