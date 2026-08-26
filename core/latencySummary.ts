// Rolling latency-quality totals over per-minute buckets, grouped into bars.
//
// Pure over the buckets it is handed: the historian reads the minutes for the
// requested range and this folds them into per-bar p95 and a whole-range
// summary (percentiles, jitter, packet loss, and a 0–100 quality score). One
// summary serves /api/latency; the dashboard renders it.
//
// Groups reuse the energy module's calendar math (energySummary) so a day is
// 14 individual days and a week is 12 individual weeks, exactly as the energy
// chart draws them.

import {
  type Range,
  energyRangeBounds,
  groupKeyOf,
  groupKeysInRange,
  nextGroupKey,
  RANGE_SPECS,
} from "./energySummary";
import {
  LATENCY_BIN_COUNT,
  LATENCY_BIN_UPPER_EDGES_MS,
  LATENCY_OVERFLOW_EDGE_MS,
  type LatencyMinuteBucket,
  type LatencyMonthBucket,
  type LatencySourceStats,
} from "./latencyBuckets";

export interface LatencyStatMetrics {
  /** Samples with a real reading in the span. 0 → every other field null. */
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Stddev of latency within the span (jitter, definition a). */
  jitter: number | null;
  /** p99 − p50 (the "latency spread" gamers quote; definition b). */
  spread: number | null;
  /** Mean fraction of pings dropped (0–100), or null when uncounted. */
  dropPct: number | null;
}

export interface LatencySummary {
  range: Range;
  coverage: { sampledSeconds: number; expectedSeconds: number; fraction: number };
  /** Whole-range quality score (dish-based), 0–100. */
  score: number;
  /** Letter grade for the score: A–F. */
  grade: string;
  dish: LatencyStatMetrics;
  router: LatencyStatMetrics | null;
  /** One row per bar in the range, oldest first. p95 drives the bar height. */
  buckets: LatencyBucketSummary[];
}

export interface LatencyBucketSummary {
  /** Epoch seconds at the bar's start. */
  t: number;
  /** Seconds of this slot the range covers; the newest slot is still filling. */
  expectedSeconds: number;
  sampledSeconds: number;
  /** p95 in ms, or null when nothing was recorded for the slot. */
  p95: number | null;
  p99: number | null;
  jitter: number | null;
  /** Mean packet-loss % over the slot. */
  dropPct: number | null;
}

const LOWER_EDGES: number[] = [0, ...LATENCY_BIN_UPPER_EDGES_MS];
const UPPER_EDGES: number[] = [...LATENCY_BIN_UPPER_EDGES_MS, LATENCY_OVERFLOW_EDGE_MS];

/** Linear-interpolated percentile (0<p<1) of a histogram, or null if empty. */
export function percentile(bins: number[], p: number): number | null {
  const total = bins.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = p * total;
  let cumBefore = 0;
  for (let i = 0; i < bins.length; i++) {
    const count = bins[i];
    const cumAfter = cumBefore + count;
    if (count > 0 && target <= cumAfter) {
      const lower = LOWER_EDGES[i];
      const upper = UPPER_EDGES[i];
      const fraction = count === 0 ? 0 : (target - cumBefore) / count;
      return lower + fraction * (upper - lower);
    }
    cumBefore = cumAfter;
  }
  // Target at the very top (p≈1 with no exact match): the highest edge.
  return LATENCY_OVERFLOW_EDGE_MS;
}

function sourceMetrics(
  stats: LatencySourceStats,
  dropSum: number,
  dropCount: number,
): LatencyStatMetrics {
  // Loss is measured even across a total outage (dropRate rides seconds with no
  // latency reading), so it must survive the no-reading early return.
  const dropPct = dropCount > 0 ? (dropSum / dropCount) * 100 : null;
  if (stats.count === 0) {
    return {
      count: 0,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
      jitter: null,
      spread: null,
      dropPct,
    };
  }
  const mean = stats.sumMs / stats.count;
  const variance = Math.max(0, stats.sumSqMs / stats.count - mean * mean);
  const p50 = percentile(stats.bins, 0.5);
  const p95 = percentile(stats.bins, 0.95);
  const p99 = percentile(stats.bins, 0.99);
  return {
    count: stats.count,
    mean,
    p50,
    p95,
    p99,
    jitter: Math.sqrt(variance),
    spread: p50 !== null && p99 !== null ? p99 - p50 : null,
    dropPct,
  };
}

/** Smooth 1→0 score between a "good" and a "bad" latency, clamped at both ends. */
function bandScore(ms: number, good: number, bad: number): number {
  if (ms <= good) return 1;
  if (ms >= bad) return 0;
  return (bad - ms) / (bad - good);
}

/** Quality score 0–100: latency tail (p95, p99), jitter, and packet loss.
 *  Weighted toward the steady-state experience a gamer or VoIP caller lives: a
 *  predictable 40 ms is worth more than a fast-but-spiky link. */
export function qualityScore(metrics: LatencyStatMetrics): number {
  if (metrics.count === 0) return 0;
  const latency = metrics.p95 === null ? 0 : bandScore(metrics.p95, 20, 250);
  const tail = metrics.p99 === null ? 0 : bandScore(metrics.p99, 50, 400);
  const jitter = metrics.jitter === null ? 0 : bandScore(metrics.jitter, 5, 60);
  const loss = metrics.dropPct === null ? 1 : bandScore(metrics.dropPct, 0, 5);
  const score = 100 * (0.4 * latency + 0.3 * jitter + 0.2 * tail + 0.1 * loss);
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** The app's status-good/warm/critical vocabulary, for a grade letter's color. */
export function gradeColorVar(grade: string): string {
  if (grade === "A" || grade === "B") return "--status-good";
  if (grade === "C") return "--chart-warm";
  return "--status-critical";
}

type AnyLatencyBucket = LatencyMinuteBucket | LatencyMonthBucket;

function emptySourceStats(): LatencySourceStats {
  return {
    count: 0,
    sumMs: 0,
    sumSqMs: 0,
    minMs: null,
    maxMs: null,
    bins: new Array(LATENCY_BIN_COUNT).fill(0),
  };
}

function mergeBuckets(buckets: AnyLatencyBucket[]): {
  dish: LatencySourceStats;
  router: LatencySourceStats;
  dropSum: number;
  dropCount: number;
} {
  const dish = emptySourceStats();
  const router = emptySourceStats();
  let dropSum = 0;
  let dropCount = 0;
  for (const bucket of buckets) {
    for (let i = 0; i < dish.bins.length; i++) {
      dish.bins[i] += bucket.dish.bins[i];
      router.bins[i] += bucket.router.bins[i];
    }
    dish.count += bucket.dish.count;
    dish.sumMs += bucket.dish.sumMs;
    dish.sumSqMs += bucket.dish.sumSqMs;
    router.count += bucket.router.count;
    router.sumMs += bucket.router.sumMs;
    router.sumSqMs += bucket.router.sumSqMs;
    dropSum += bucket.dropSum;
    dropCount += bucket.dropCount;
  }
  return { dish, router, dropSum, dropCount };
}

function rangeSummary(
  buckets: AnyLatencyBucket[],
  range: Range,
  now: Date,
): Omit<LatencySummary, "buckets"> {
  const { startSec, endSec } = energyRangeBounds(range, now);
  const sampledSeconds = buckets.reduce((sum, bucket) => sum + bucket.samples, 0);
  const expectedSeconds = Math.max(1, endSec - startSec);

  // Whole-range metrics combine every minute the range spans.
  const merged = mergeBuckets(buckets);
  const dish = sourceMetrics(merged.dish, merged.dropSum, merged.dropCount);
  const routerCount = merged.router.count;
  // The buckets carry only the dish's drop accumulator; the router's own loss is
  // a five-minute rolling value, not a per-second series we can fold, so its loss
  // is reported as unknown rather than borrowing the dish's figure.
  const router = routerCount > 0 ? sourceMetrics(merged.router, 0, 0) : null;
  const score = qualityScore(dish);

  return {
    range,
    coverage: {
      sampledSeconds,
      expectedSeconds,
      fraction: Math.min(1, sampledSeconds / expectedSeconds),
    },
    score,
    grade: gradeFor(score),
    dish,
    router,
  };
}

/** Fold the range's latency buckets into per-bar p95 and a whole-range summary. */
export function summarizeLatency(
  buckets: LatencyMinuteBucket[],
  range: Range,
  now: Date,
): LatencySummary {
  const spec = RANGE_SPECS[range];
  const { startSec, endSec } = energyRangeBounds(range, now);

  const byKey = new Map<number, LatencyMinuteBucket[]>();
  for (const bucket of buckets) {
    const key = groupKeyOf(bucket.minute, spec);
    const list = byKey.get(key) ?? [];
    list.push(bucket);
    byKey.set(key, list);
  }

  const barMetrics = groupKeysInRange(startSec, endSec, spec).map((t) => {
    const expectedSeconds = Math.max(
      0,
      Math.min(nextGroupKey(t, spec), endSec) - Math.max(t, startSec),
    );
    const group = byKey.get(t);
    if (!group) {
      return {
        t,
        expectedSeconds,
        sampledSeconds: 0,
        p95: null,
        p99: null,
        jitter: null,
        dropPct: null,
      };
    }
    const merged = mergeBuckets(group);
    const metrics = sourceMetrics(merged.dish, merged.dropSum, merged.dropCount);
    return {
      t,
      expectedSeconds,
      sampledSeconds: group.reduce((sum, bucket) => sum + bucket.samples, 0),
      p95: metrics.p95,
      p99: metrics.p99,
      jitter: metrics.jitter,
      dropPct: metrics.dropPct,
    };
  });

  return { ...rangeSummary(buckets, range, now), buckets: barMetrics };
}
