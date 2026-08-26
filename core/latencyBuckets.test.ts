import { describe, expect, it } from "vitest";
import type { TelemetrySample } from "./telemetry";
import {
  LATENCY_BIN_COUNT,
  foldSamplesToLatencyMinutes,
  foldLatencyMinutesToMonths,
  latencyMonthKeyOf,
  binIndexFor,
} from "./latencyBuckets";

function sample(timestampMs: number, latencyMs: number | null, dropRate = 0): TelemetrySample {
  return {
    timestampMs,
    latencyMs,
    dropRate,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 0,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  };
}

describe("foldSamplesToLatencyMinutes", () => {
  it("buckets readings by minute and ignores null/sentinel latencies", () => {
    const samples = [
      sample(60_000, 25), // minute 60
      sample(61_000, 30),
      sample(62_000, null), // not a reading
      sample(63_000, -5), // sentinel, skipped
      sample(120_000, 80), // minute 120
    ];
    const buckets = foldSamplesToLatencyMinutes(samples);
    expect(buckets.size).toBe(2);
    const first = buckets.get(60)!;
    expect(first.dish.count).toBe(2);
    expect(first.dish.sumMs).toBe(55);
    expect(first.dish.minMs).toBe(25);
    expect(first.dish.maxMs).toBe(30);
    const second = buckets.get(120)!;
    expect(second.dish.count).toBe(1);
    expect(second.dish.sumMs).toBe(80);
  });

  it("rolls every recorded second's drop rate in, outage seconds included", () => {
    const samples = [
      sample(60_000, 25, 0.02),
      sample(61_000, null, 1), // outage second: no latency, but 100% loss counts
    ];
    const bucket = foldSamplesToLatencyMinutes(samples).get(60)!;
    expect(bucket.dropSum).toBeCloseTo(1.02);
    expect(bucket.dropCount).toBe(2);
    expect(bucket.samples).toBe(2);
    expect(bucket.dish.count).toBe(1);
  });

  it("places a reading in the right histogram bin", () => {
    // 25 ms lands in the bin [20,30); 250 ms in the 200–300 tail bin.
    const bucket = foldSamplesToLatencyMinutes([sample(60_000, 25), sample(61_000, 250)]).get(60)!;
    expect(bucket.dish.bins[binIndexFor(25)]).toBe(1);
    expect(bucket.dish.bins[binIndexFor(250)]).toBe(1);
    expect(LATENCY_BIN_COUNT).toBe(bucket.dish.bins.length);
  });

  it("accumulates router readings separately from the dish", () => {
    const routerSample: TelemetrySample = {
      timestampMs: 60_000,
      latencyMs: 25,
      dropRate: 0,
      downlinkBps: 0,
      uplinkBps: 0,
      powerW: 0,
      routerLatencyMs: 42,
      routerPingSuccessPercent: 100,
    };
    const bucket = foldSamplesToLatencyMinutes([routerSample]).get(60)!;
    expect(bucket.dish.count).toBe(1);
    expect(bucket.router.count).toBe(1);
    expect(bucket.router.sumMs).toBe(42);
  });
});

describe("foldLatencyMinutesToMonths", () => {
  it("groups minutes into their calendar month", () => {
    const minutes = [
      { minute: 0, samples: 1, dish: empty(), router: empty(), dropSum: 0, dropCount: 0 },
      {
        minute: 60 * 60 * 24 * 40,
        samples: 1,
        dish: empty(),
        router: empty(),
        dropSum: 0,
        dropCount: 0,
      },
    ];
    const months = foldLatencyMinutesToMonths(minutes as never);
    expect(months.size).toBe(2); // two distinct months from epoch-based minutes
    for (const row of months.values()) expect(row.samples).toBe(1);
  });

  it("latencyMonthKeyOf pins to the first of the month", () => {
    const key = latencyMonthKeyOf(Math.floor(new Date(2026, 6, 15, 12).getTime() / 1000));
    expect(new Date(key * 1000).getDate()).toBe(1);
  });
});

function empty() {
  return {
    count: 0,
    sumMs: 0,
    sumSqMs: 0,
    minMs: null,
    maxMs: null,
    bins: new Array(LATENCY_BIN_COUNT).fill(0),
  };
}
