// Rolling energy/traffic totals over per-minute buckets, grouped into bars.
//
// Pure over the buckets it is handed: the caller fetches the minutes for the
// range (the historian from its ndjson store plus the in-progress minute; the
// extension from IndexedDB) and this folds them into per-bar and whole-range
// totals. One summary serves both /api/energy (kWh) and /api/usage (GB) — energy
// and traffic ride the same buckets.

import { type MinuteBucket } from "./energyBuckets";

export type Range = "1h" | "6h" | "12h" | "today" | "day" | "week" | "month";

export const RANGES: Range[] = ["1h", "6h", "12h", "today", "day", "week", "month"];

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

/** The range's [startSec, endSec) window, so a caller can fetch the minutes to fold. */
export function energyRangeBounds(range: Range, now: Date): { startSec: number; endSec: number } {
  return { startSec: RANGE_SPECS[range].startSec(now), endSec: Math.floor(now.getTime() / 1000) };
}

/** Fold the range's minute buckets into per-bar and whole-range totals. */
export function summarizeEnergy(buckets: MinuteBucket[], range: Range, now: Date) {
  const spec = RANGE_SPECS[range];
  const { startSec, endSec } = energyRangeBounds(range, now);

  const groups = new Map<
    number,
    { wattSeconds: number; samples: number; downlinkBits: number; uplinkBits: number }
  >();
  let totalWattSeconds = 0;
  let sampledSeconds = 0;
  let totalDownlinkBits = 0;
  let totalUplinkBits = 0;
  for (const bucket of buckets) {
    const key = groupKeyOf(bucket.minute, spec);
    const group = groups.get(key) ?? { wattSeconds: 0, samples: 0, downlinkBits: 0, uplinkBits: 0 };
    group.wattSeconds += bucket.wattSeconds;
    group.samples += bucket.samples;
    group.downlinkBits += bucket.downlinkBits ?? 0;
    group.uplinkBits += bucket.uplinkBits ?? 0;
    groups.set(key, group);
    totalWattSeconds += bucket.wattSeconds;
    sampledSeconds += bucket.samples;
    totalDownlinkBits += bucket.downlinkBits ?? 0;
    totalUplinkBits += bucket.uplinkBits ?? 0;
  }

  const BITS_PER_GB = 8e9;
  const expectedSeconds = Math.max(1, endSec - startSec);
  return {
    range,
    totalKWh: totalWattSeconds / 3_600_000,
    totalDownGB: totalDownlinkBits / BITS_PER_GB,
    totalUpGB: totalUplinkBits / BITS_PER_GB,
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
        downGB: group.downlinkBits / BITS_PER_GB,
        upGB: group.uplinkBits / BITS_PER_GB,
        sampledSeconds: group.samples,
        expectedSeconds,
      };
    }),
  };
}
