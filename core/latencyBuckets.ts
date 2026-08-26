// Per-minute latency aggregates folded from per-second telemetry samples, so a
// day or week of latency quality can be summarised without keeping every 1 Hz
// sample (those are trimmed to six hours). Pure and IO-free, so both recorders
// — the collector and the extension — share one definition of a minute's latency
// shape; the collector folds a poll's samples before appending to disk, the
// extension (if it adopts this) folds each drain the same way. Both must agree
// on what a minute holds or their histories diverge.
//
// A minute keeps, per source (dish pop-ping and router pop-ping), a 16-bin
// histogram plus the running sums needed for a mean and a standard deviation.
// The histogram lets us reconstruct percentiles (p50/p95/p99) by combining any
// span of minutes into one distribution; the sums give the window's jitter
// (stddev) and mean directly. 16 bins × 2 sources per minute is small enough to
// keep a year of minutes on disk, yet resolves the 0–100 ms band Starlink
// latency mostly lives in to 10 ms.

import type { TelemetrySample } from "./telemetry";

// 10 ms steps across the band latency normally occupies, then a few coarser
// tail bins for the spikes bad weather throws, and an overflow past 1 s.
const FINE_STEP_MS = 10;
const FINE_UPPER_MS = 100;
const TAIL_EDGES_MS = [150, 200, 300, 500, 1000];

/** Upper edge (exclusive) of each bin, in ms; BIN_COUNT-1 is the >1 s overflow. */
export const LATENCY_BIN_UPPER_EDGES_MS: readonly number[] = [
  ...Array.from({ length: FINE_UPPER_MS / FINE_STEP_MS }, (_, i) => (i + 1) * FINE_STEP_MS),
  ...TAIL_EDGES_MS,
];

/** One histogram bin per edge, plus the final overflow bin. */
export const LATENCY_BIN_COUNT = LATENCY_BIN_UPPER_EDGES_MS.length + 1;

/** The finite top of the distribution, used when a percentile lands in overflow. */
export const LATENCY_OVERFLOW_EDGE_MS = TAIL_EDGES_MS[TAIL_EDGES_MS.length - 1];

export interface LatencySourceStats {
  /** Samples with a real reading this minute (finite, > 0). */
  count: number;
  sumMs: number;
  sumSqMs: number;
  minMs: number | null;
  maxMs: number | null;
  /** Count per histogram bin, indexed by LATENCY_BIN_UPPER_EDGES_MS. */
  bins: number[];
}

function emptySource(): LatencySourceStats {
  return {
    count: 0,
    sumMs: 0,
    sumSqMs: 0,
    minMs: null,
    maxMs: null,
    bins: new Array(LATENCY_BIN_COUNT).fill(0),
  };
}

export function binIndexFor(latencyMs: number): number {
  for (let i = 0; i < LATENCY_BIN_UPPER_EDGES_MS.length; i++) {
    if (latencyMs < LATENCY_BIN_UPPER_EDGES_MS[i]) return i;
  }
  return LATENCY_BIN_COUNT - 1;
}

function addReading(stats: LatencySourceStats, latencyMs: number): void {
  const bin = binIndexFor(latencyMs);
  stats.bins[bin] += 1;
  stats.count += 1;
  stats.sumMs += latencyMs;
  stats.sumSqMs += latencyMs * latencyMs;
  stats.minMs = stats.minMs === null ? latencyMs : Math.min(stats.minMs, latencyMs);
  stats.maxMs = stats.maxMs === null ? latencyMs : Math.max(stats.maxMs, latencyMs);
}

export interface LatencyMinuteBucket {
  /** Epoch seconds at the minute's start. */
  minute: number;
  samples: number;
  dish: LatencySourceStats;
  router: LatencySourceStats;
  /** Sum of the dish's per-sample drop rate (0–1); divide by dropCount for %. */
  dropSum: number;
  dropCount: number;
}

/** Whether a sample's latency field is a real measurement, not a sentinel. */
function isReading(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/** Group per-second samples into per-minute latency buckets. Each sample ≈ 1s. */
export function foldSamplesToLatencyMinutes(
  samples: TelemetrySample[],
): Map<number, LatencyMinuteBucket> {
  const buckets = new Map<number, LatencyMinuteBucket>();
  for (const sample of samples) {
    const minute = Math.floor(sample.timestampMs / 60_000) * 60;
    const bucket = buckets.get(minute) ?? {
      minute,
      samples: 0,
      dish: emptySource(),
      router: emptySource(),
      dropSum: 0,
      dropCount: 0,
    };
    // samples is seconds recorded, not seconds up: an outage second still rode a
    // poll and counts toward coverage, matching the energy fold.
    bucket.samples += 1;
    if (isReading(sample.latencyMs)) addReading(bucket.dish, sample.latencyMs);
    if (isReading(sample.routerLatencyMs)) addReading(bucket.router, sample.routerLatencyMs);
    // dropRate is the dish's own fraction of pings lost, and it is valid exactly
    // when latency is null: an outage second is dropRate 1 with no ping to time.
    if (Number.isFinite(sample.dropRate)) {
      bucket.dropSum += sample.dropRate;
      bucket.dropCount += 1;
    }
    buckets.set(minute, bucket);
  }
  return buckets;
}

/** Replace (not add) — the historian recomputes the in-progress minute from the
 *  dish's ring each poll, so re-seeing it must overwrite, never accumulate. */
export function replaceLatencyMinuteBucket(
  _base: LatencyMinuteBucket | undefined,
  delta: LatencyMinuteBucket,
): LatencyMinuteBucket {
  return {
    ...delta,
    dish: { ...delta.dish, bins: [...delta.dish.bins] },
    router: { ...delta.router, bins: [...delta.router.bins] },
  };
}

export interface LatencyMonthBucket {
  /** Epoch seconds at the local start of the month. */
  month: number;
  samples: number;
  dish: LatencySourceStats;
  router: LatencySourceStats;
  dropSum: number;
  dropCount: number;
}

/** Local start of the calendar month a minute falls in, epoch seconds. */
export function latencyMonthKeyOf(minuteSec: number): number {
  const date = new Date(minuteSec * 1000);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return Math.floor(date.getTime() / 1000);
}

/** Local start of the current calendar year, epoch seconds — the boundary the
 *  minute store keeps detail back to. */
export function latencyYearStartSec(now: Date): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setMonth(0, 1);
  return Math.floor(date.getTime() / 1000);
}

function addSource(base: LatencySourceStats, add: LatencySourceStats): LatencySourceStats {
  const bins = base.bins.slice();
  for (let i = 0; i < bins.length; i++) bins[i] += add.bins[i];
  return {
    count: base.count + add.count,
    sumMs: base.sumMs + add.sumMs,
    sumSqMs: base.sumSqMs + add.sumSqMs,
    minMs:
      base.minMs === null
        ? add.minMs
        : add.minMs === null
          ? base.minMs
          : Math.min(base.minMs, add.minMs),
    maxMs:
      base.maxMs === null
        ? add.maxMs
        : add.maxMs === null
          ? base.maxMs
          : Math.max(base.maxMs, add.maxMs),
    bins,
  };
}

function addMinute(
  into: LatencyMonthBucket,
  from: {
    dish: LatencySourceStats;
    router: LatencySourceStats;
    samples: number;
    dropSum: number;
    dropCount: number;
  },
): LatencyMonthBucket {
  return {
    month: into.month,
    samples: into.samples + from.samples,
    dish: addSource(into.dish, from.dish),
    router: addSource(into.router, from.router),
    dropSum: into.dropSum + from.dropSum,
    dropCount: into.dropCount + from.dropCount,
  };
}

/** Group expired minute buckets into per-month archive rows, summing their
 *  histograms and stats. Pure — callers decide what counts as expired and how
 *  the result is merged with a month's existing row. */
export function foldLatencyMinutesToMonths(
  buckets: LatencyMinuteBucket[],
): Map<number, LatencyMonthBucket> {
  const months = new Map<number, LatencyMonthBucket>();
  for (const bucket of buckets) {
    const month = latencyMonthKeyOf(bucket.minute);
    const row = months.get(month) ?? {
      month,
      samples: 0,
      dish: emptySource(),
      router: emptySource(),
      dropSum: 0,
      dropCount: 0,
    };
    months.set(month, addMinute(row, bucket));
  }
  return months;
}

/** Merge a freshly folded month onto whatever its row already holds (an archive
 *  touched by a later-arriving minute keeps its earlier fold). */
export function addLatencyMonthBucket(
  base: LatencyMonthBucket | undefined,
  delta: LatencyMonthBucket,
): LatencyMonthBucket {
  if (!base)
    return {
      ...delta,
      dish: { ...delta.dish, bins: [...delta.dish.bins] },
      router: { ...delta.router, bins: [...delta.router.bins] },
    };
  return addMinute(base, delta);
}
