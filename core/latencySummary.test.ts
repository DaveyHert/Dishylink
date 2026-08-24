import { describe, expect, it } from "vitest";
import {
  percentile,
  qualityScore,
  gradeFor,
  summarizeLatency,
  type LatencyBucketSummary,
} from "./latencySummary";
import { LATENCY_BIN_COUNT, LATENCY_BIN_UPPER_EDGES_MS } from "./latencyBuckets";
import type { LatencyMinuteBucket } from "./latencyBuckets";

function emptyBins(): number[] {
  return new Array(LATENCY_BIN_COUNT).fill(0);
}

/** A bucket whose dish readings are the given latencies (all in one minute). */
function bucket(minute: number, latencies: number[], dropRate = 0): LatencyMinuteBucket {
  const bins = emptyBins();
  let sumMs = 0;
  let sumSqMs = 0;
  for (const ms of latencies) {
    let idx = LATENCY_BIN_UPPER_EDGES_MS.findIndex((edge) => ms < edge);
    if (idx === -1) idx = LATENCY_BIN_COUNT - 1;
    bins[idx] += 1;
    sumMs += ms;
    sumSqMs += ms * ms;
  }
  return {
    minute,
    samples: latencies.length,
    dish: {
      count: latencies.length,
      sumMs,
      sumSqMs,
      minMs: Math.min(...latencies),
      maxMs: Math.max(...latencies),
      bins,
    },
    router: { count: 0, sumMs: 0, sumSqMs: 0, minMs: null, maxMs: null, bins: emptyBins() },
    dropSum: dropRate * latencies.length,
    dropCount: latencies.length,
  };
}

describe("percentile", () => {
  it("returns null for an empty histogram", () => {
    expect(percentile(emptyBins(), 0.95)).toBeNull();
  });

  it("is exact for a uniform distribution", () => {
    // 1..100 inclusive → true p50 = 50.5, p95 = 95.5; the 10 ms histogram
    // quantizes to 51 / 96 (≈0.5 ms error per percentile) and the linear
    // interpolation inside the bin recovers it to within half a bin.
    const bins = emptyBins();
    for (let ms = 1; ms <= 100; ms++) {
      let idx = LATENCY_BIN_UPPER_EDGES_MS.findIndex((edge) => ms < edge);
      if (idx === -1) idx = LATENCY_BIN_COUNT - 1;
      bins[idx] += 1;
    }
    expect(percentile(bins, 0.5)).toBeCloseTo(51, 0);
    expect(percentile(bins, 0.95)).toBeCloseTo(96, 0);
  });

  it("saturates tail percentiles at the finite edge when they fall in overflow", () => {
    const bins = emptyBins();
    bins[LATENCY_BIN_COUNT - 1] = 100; // everything > 1 s
    // All mass in overflow; p95 lands there and is clamped to the last finite edge.
    expect(percentile(bins, 0.95)).toBe(
      LATENCY_BIN_UPPER_EDGES_MS[LATENCY_BIN_UPPER_EDGES_MS.length - 1],
    );
  });
});

describe("qualityScore", () => {
  it("is 0 with no samples", () => {
    expect(
      qualityScore({
        count: 0,
        mean: null,
        p50: null,
        p95: null,
        p99: null,
        jitter: null,
        spread: null,
        dropPct: null,
      }),
    ).toBe(0);
  });

  it("rewards a fast, steady, lossless link with a high score", () => {
    const score = qualityScore({
      count: 100,
      mean: 28,
      p50: 28,
      p95: 35,
      p99: 45,
      jitter: 4,
      spread: 17,
      dropPct: 0,
    });
    expect(score).toBeGreaterThanOrEqual(90);
    expect(gradeFor(score)).toBe("A");
  });

  it("penalises a spikey, lossy link", () => {
    const score = qualityScore({
      count: 100,
      mean: 180,
      p50: 150,
      p95: 320,
      p99: 480,
      jitter: 70,
      spread: 330,
      dropPct: 6,
    });
    expect(score).toBeLessThan(40);
    expect(gradeFor(score)).toBe("F");
  });
});

describe("summarizeLatency", () => {
  const now = new Date();
  // Two back-to-back minutes of identical latency → a clean p50/p95.
  const buckets = [bucket(0, [20, 25, 30]), bucket(60, [20, 25, 30])];

  it("derives whole-range metrics from the combined histogram", () => {
    const summary = summarizeLatency(buckets, "today", now);
    expect(summary.dish.count).toBe(6);
    expect(summary.dish.p50).not.toBeNull();
    expect(summary.dish.p95).not.toBeNull();
    expect(summary.dish.jitter).not.toBeNull();
    expect(summary.score).toBeGreaterThan(0);
  });

  it("emits one bar per calendar slot in the range", () => {
    const summary = summarizeLatency(buckets, "today", now);
    expect(summary.buckets.length).toBeGreaterThan(0);
    const first: LatencyBucketSummary = summary.buckets[0];
    expect(first).toHaveProperty("p95");
    expect(first).toHaveProperty("jitter");
    expect(first).toHaveProperty("dropPct");
  });

  it("returns null stats and zero score when no minutes fall in range", () => {
    // A window ending before any sample exists → empty.
    const summary = summarizeLatency([], "today", now);
    expect(summary.score).toBe(0);
    expect(summary.dish.count).toBe(0);
    expect(summary.dish.p95).toBeNull();
  });
});
