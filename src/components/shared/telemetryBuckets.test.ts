import { describe, expect, test } from "vitest";
import type { TelemetrySample } from "@core/telemetry";
import { telemetryBuckets } from "./telemetryBuckets";

const END = 1_800_000_000_000;
const DURATION = 900_000;
const WIDTH = 802;
const series = (["avg", "max", "min"] as const).map((bucketReduce) => ({
  getValue: (sample: TelemetrySample) => sample.latencyMs,
  bucketReduce,
}));
function sample(timestampMs: number, latencyMs: number | null = 40): TelemetrySample {
  return {
    timestampMs,
    latencyMs,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 30,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  };
}
function bucket(samples: TelemetrySample[], end = END, width = WIDTH, minGapMs = 30_000) {
  return telemetryBuckets(samples, series, end - DURATION, end, width, minGapMs);
}

describe("telemetryBuckets production aggregation", () => {
  const samples = Array.from({ length: 1100 }, (_, index) =>
    sample(END - 1_100_000 + index * 1000, ((index * 37) % 101) + (index % 19 === 0 ? 200 : 0)),
  );

  test("keeps completed interior timestamps and all reductions after +5s and new data", () => {
    const before = bucket(samples);
    const span = before.bucketSpanMs;
    expect(span).toBe(Math.ceil(DURATION / Math.max(Math.floor(WIDTH / 2), 30)));
    const interior = before.buckets.filter((point) => {
      const start = Math.floor(point.timestampMs / span) * span;
      return start >= END + 5000 - DURATION && start + span <= END;
    });
    expect(interior.length).toBeGreaterThan(390);
    for (const nextSamples of [
      samples,
      [...samples, ...Array.from({ length: 5 }, (_, index) => sample(END + index * 1000, 900))],
    ]) {
      const after = bucket(nextSamples, END + 5000);
      expect(after.bucketSpanMs).toBe(span);
      const byTime = new Map(after.buckets.map((point) => [point.timestampMs, point]));
      for (const point of interior) expect(byTime.get(point.timestampMs)).toEqual(point);
    }
  });

  test("sparse and empty streams use pixel span, not sample count", () => {
    const sparse = samples.slice(-10);
    expect(bucket(sparse).bucketSpanMs).toBe(bucket(samples).bucketSpanMs);
    expect(bucket([...sparse, sample(END)], END + 1000).bucketSpanMs).toBe(
      bucket(sparse).bucketSpanMs,
    );
    expect(bucket([]).bucketSpanMs).toBe(bucket(samples).bucketSpanMs);
    expect(bucket(sparse, END, 50).bucketSpanMs).toBe(Math.ceil(DURATION / 30));
  });

  test("ignores null and nonfinite values; all-null buckets remain null per series", () => {
    const span = bucket([]).bucketSpanMs;
    const start = Math.floor((END - 60_000) / span) * span;
    const result = bucket([
      sample(start, null),
      sample(start + 1, NaN),
      sample(start + 2, Infinity),
      sample(start + 3, 10),
      sample(start + 4, 30),
      sample(start + span, null),
    ]);
    expect(result.buckets.map((point) => point.values)).toEqual([
      [20, 30, 10],
      [null, null, null],
    ]);
    const mixed = telemetryBuckets(
      [sample(start, null)],
      [...series, { getValue: (value) => value.powerW }],
      END - DURATION,
      END,
      WIDTH,
      30_000,
    );
    expect(mixed.buckets[0].values).toEqual([null, null, null, 30]);
  });

  test("clips only edge midpoints and preserves half-open and frozen boundaries", () => {
    const end = END + 123;
    const start = end - DURATION;
    const inputs = [sample(start - 1, 999), sample(start, 10), sample(end - 1, 30)];
    const frozen = bucket(inputs, end);
    expect(frozen.buckets).toHaveLength(2);
    expect(frozen.buckets.map((point) => point.values)).toEqual([
      [10, 10, 10],
      [30, 30, 30],
    ]);
    for (const point of frozen.buckets) {
      expect(point.timestampMs).toBeGreaterThanOrEqual(start);
      expect(point.timestampMs).toBeLessThan(end);
    }
    const span = frozen.bucketSpanMs;
    expect(frozen.buckets[0].timestampMs).toBe((start + (Math.floor(start / span) + 1) * span) / 2);
    expect(frozen.buckets[1].timestampMs).toBe((Math.floor((end - 1) / span) * span + end) / 2);
    expect(bucket([...inputs, sample(end, 999), sample(end + 5000, 999)], end)).toEqual(frozen);
  });

  test("marks internal, leading and growing trailing gaps", () => {
    const inputs = [sample(END - 600_000), sample(END - 599_000), sample(END - 300_000)];
    const result = bucket(inputs);
    expect(result.buckets[0].hasGapBefore).toBe(false);
    expect(result.buckets.at(-1)?.hasGapBefore).toBe(true);
    expect(result.gapRegions).toHaveLength(3);
    expect(result.gapRegions[0].startMs).toBe(END - DURATION);
    expect(result.gapRegions.at(-1)?.endMs).toBe(END);
    const later = bucket(inputs, END + 5000);
    expect(later.buckets).toEqual(result.buckets);
    expect(later.gapRegions.at(-1)?.startMs).toBe(result.gapRegions.at(-1)?.startMs);
    expect(later.gapRegions.at(-1)?.endMs).toBe(END + 5000);
    expect(bucket(inputs, END, WIDTH, 700_000).gapRegions).toEqual([]);
    expect(bucket(inputs, END, WIDTH, 700_000).buckets.every((point) => !point.hasGapBefore)).toBe(
      true,
    );
  });

  test("uses epoch spacing for gaps even when edge midpoint is clipped", () => {
    const span = bucket([]).bucketSpanMs;
    const start = END - DURATION;
    const key = Math.floor(start / span);
    const result = bucket([sample(start), sample((key + 2) * span)], END, WIDTH, 0);
    expect(result.buckets[1].hasGapBefore).toBe(true);
    const adjacent = bucket([sample(start), sample((key + 1) * span)], END, WIDTH, 0);
    expect(adjacent.buckets[1].hasGapBefore).toBe(false);
  });

  test("stale and empty windows shade entire interval without retaining old points", () => {
    for (const inputs of [[], samples]) {
      const end = END + 7_200_000;
      const result = bucket(inputs, end);
      expect(result.buckets).toEqual([]);
      expect(result.gapRegions).toEqual([{ startMs: end - DURATION, endMs: end }]);
    }
  });
});
