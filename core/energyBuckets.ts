// Per-minute energy + traffic buckets folded from per-second telemetry samples.
// Pure and IO-free, so every host shares one definition of a minute's total:
// the collector folds a poll's samples before appending them to disk, and the
// extension folds each cursor-gated drain before an additive upsert into
// IndexedDB. Both must agree on what a minute holds, or their histories diverge.

import type { TelemetrySample } from "./telemetry";

export interface MinuteBucket {
  minute: number;
  wattSeconds: number;
  samples: number;
  /** Downlink/uplink volume in bits (absent on rows written before data-usage tracking). */
  downlinkBits?: number;
  uplinkBits?: number;
}

/**
 * Sum a minute's running total with a freshly folded delta for the same minute.
 * A minute can fill across several drains — the extension wakes, drains only the
 * samples past its cursor, and adds them to whatever that minute already held.
 * Because the cursor guarantees each sample is drained once, adding is exact:
 * nothing is counted twice, and a minute split over two wakes still totals right.
 */
export function addMinuteBucket(base: MinuteBucket | undefined, delta: MinuteBucket): MinuteBucket {
  if (!base) return { ...delta };
  return {
    minute: delta.minute,
    wattSeconds: base.wattSeconds + delta.wattSeconds,
    samples: base.samples + delta.samples,
    downlinkBits: (base.downlinkBits ?? 0) + (delta.downlinkBits ?? 0),
    uplinkBits: (base.uplinkBits ?? 0) + (delta.uplinkBits ?? 0),
  };
}

/** Group per-second samples into per-minute energy+traffic buckets. Each sample ≈ 1s. */
export function foldSamplesToMinutes(samples: TelemetrySample[]): Map<number, MinuteBucket> {
  const buckets = new Map<number, MinuteBucket>();
  for (const sample of samples) {
    const minute = Math.floor(sample.timestampMs / 60_000) * 60;
    const bucket = buckets.get(minute) ?? {
      minute,
      wattSeconds: 0,
      samples: 0,
      downlinkBits: 0,
      uplinkBits: 0,
    };
    bucket.wattSeconds += sample.powerW ?? 0;
    // per-second sample: bps over one second ≈ bits transferred
    bucket.downlinkBits = (bucket.downlinkBits ?? 0) + (sample.downlinkBps ?? 0);
    bucket.uplinkBits = (bucket.uplinkBits ?? 0) + (sample.uplinkBps ?? 0);
    bucket.samples += 1;
    buckets.set(minute, bucket);
  }
  return buckets;
}

/** One archived calendar month, folded from that month's minutes — the row a
 *  minute-level store keeps once the minute itself has aged out of detail
 *  retention, so a year of history stays answerable as one row per month
 *  instead of one row per minute. */
export interface MonthBucket {
  /** Epoch seconds at the local start of the month. */
  month: number;
  wattSeconds: number;
  /** Minutes actually recorded that month — the honesty check on a summary. */
  samples: number;
  downlinkBits: number;
  uplinkBits: number;
}

/** Local start of the current calendar year, epoch seconds. */
export function startOfYearSec(now: Date): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setMonth(0, 1);
  return Math.floor(date.getTime() / 1000);
}

/** Local start of the calendar month a minute falls in, epoch seconds. */
export function monthKeyOf(minuteSec: number): number {
  const date = new Date(minuteSec * 1000);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return Math.floor(date.getTime() / 1000);
}

/** Sum a month's running total with a freshly folded delta for the same month —
 *  the archive-side counterpart to addMinuteBucket, for a month re-folded after
 *  already holding an earlier archive (a backfill landing on already-archived
 *  minutes, rather than the ordinary case of folding forward from raw ones). */
export function addMonthBucket(base: MonthBucket | undefined, delta: MonthBucket): MonthBucket {
  if (!base) return { ...delta };
  return {
    month: delta.month,
    wattSeconds: base.wattSeconds + delta.wattSeconds,
    samples: base.samples + delta.samples,
    downlinkBits: base.downlinkBits + delta.downlinkBits,
    uplinkBits: base.uplinkBits + delta.uplinkBits,
  };
}

/** Group a set of expired minute buckets into per-month archive rows. Pure —
 *  callers decide what counts as expired and how the result is merged with
 *  whatever a month's row already holds. */
export function foldMinutesToMonths(buckets: MinuteBucket[]): Map<number, MonthBucket> {
  const months = new Map<number, MonthBucket>();
  for (const bucket of buckets) {
    const month = monthKeyOf(bucket.minute);
    const row = months.get(month) ?? {
      month,
      wattSeconds: 0,
      samples: 0,
      downlinkBits: 0,
      uplinkBits: 0,
    };
    row.wattSeconds += bucket.wattSeconds;
    row.samples += bucket.samples;
    row.downlinkBits += bucket.downlinkBits ?? 0;
    row.uplinkBits += bucket.uplinkBits ?? 0;
    months.set(month, row);
  }
  return months;
}
