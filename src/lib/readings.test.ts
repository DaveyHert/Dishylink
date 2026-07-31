// The stat tiles report what the dish is doing now, so their spans are cut from
// the clock. A dish that stops answering stops appending samples, and a span
// counted in readings would sit on the last healthy minute and present it as the
// current one — a tile reading 100% ping success with the dish unreachable.

import { describe, it, expect } from "vitest";
import { powerBucketMean, recentAverage, sparklineFrom, hasRecentReadings } from "./readings";
import type { TelemetrySample } from "@core/telemetry";

const NOW = 1_784_400_000_000;

/** `count` readings at 1 Hz ending `endMs`, every sample carrying `value`. */
function readings(endMs: number, count: number, value: number): TelemetrySample[] {
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: endMs - (count - 1 - index) * 1000,
    latencyMs: value,
    dropRate: 0,
    downlinkBps: value,
    uplinkBps: value,
    powerW: value,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  }));
}

describe("recentAverage", () => {
  it("averages the readings inside the last minute", () => {
    expect(recentAverage(readings(NOW, 120, 40), (s) => s.powerW, NOW)).toBe(40);
  });

  it("goes to zero once the dish has been silent for a minute", () => {
    // Every reading is healthy, and every one of them is too old to speak for now.
    const stale = readings(NOW - 8 * 60_000, 120, 40);
    expect(recentAverage(stale, (s) => s.powerW, NOW)).toBe(0);
  });

  it("weighs only the part of the minute that was recorded", () => {
    // Readings stopped 30s ago: the 30s that exist count, the silent 30s do not
    // drag the mean down and do not prop it up either.
    const partial = readings(NOW - 30_000, 30, 40);
    expect(recentAverage(partial, (s) => s.powerW, NOW)).toBe(40);
  });
});

describe("powerBucketMean", () => {
  // NOW sits on a 5s boundary, so the last completed bucket is [NOW-5s, NOW).

  it("averages the last completed 5-second bucket", () => {
    expect(powerBucketMean(readings(NOW, 30, 40), NOW)).toBe(40);
  });

  it("dilutes a spike into the bucket mean rather than showing it raw", () => {
    // One 100W second among four 40W seconds: (4·40 + 100) / 5 = 52.
    const spiky = readings(NOW, 30, 40);
    spiky[spiky.length - 2].powerW = 100; // NOW-1000, inside the completed bucket
    expect(powerBucketMean(spiky, NOW)).toBe(52);
  });

  it("holds steady within a bucket and steps at the boundary", () => {
    // Two full buckets: the older reads 20W, the newer 40W.
    const twoBuckets = readings(NOW, 30, 0).map((sample) => ({
      ...sample,
      powerW: sample.timestampMs < NOW - 5_000 ? 20 : 40,
    }));
    expect(powerBucketMean(twoBuckets, NOW - 1)).toBe(20); // still in the older bucket
    expect(powerBucketMean(twoBuckets, NOW)).toBe(40); // boundary crossed
  });

  it("skips a dropped ring entry rather than averaging its zero in", () => {
    const gappy = readings(NOW, 30, 40);
    gappy[gappy.length - 2].powerW = 0; // NOW-1000, a decoded gap
    expect(powerBucketMean(gappy, NOW)).toBe(40);
  });

  it("reaches back to the last bucket with a reading when the latest is empty", () => {
    // The dish just returned from a gap: its freshest sample sits at NOW-6s, so
    // the latest completed bucket [NOW-5s, NOW) is empty while [NOW-10s, NOW-5s)
    // holds real draws. The figure shows those rather than flashing 0 W.
    expect(powerBucketMean(readings(NOW - 6_000, 30, 40), NOW)).toBe(40);
  });

  it("reads zero once nothing in the last minute holds a reading", () => {
    // Data ends 90s ago — past the fallback reach, so the dish is genuinely quiet.
    expect(powerBucketMean(readings(NOW - 90_000, 30, 40), NOW)).toBe(0);
  });
});

describe("sparklineFrom", () => {
  it("draws the last 90 seconds", () => {
    expect(sparklineFrom(readings(NOW, 300, 40), (s) => s.powerW, NOW)).toHaveLength(91);
  });

  it("empties as the dish stays silent", () => {
    const stale = readings(NOW - 10 * 60_000, 300, 40);
    expect(sparklineFrom(stale, (s) => s.powerW, NOW)).toEqual([]);
  });
});

describe("hasRecentReadings", () => {
  it("is true while readings are arriving", () => {
    expect(hasRecentReadings(readings(NOW, 60, 40), NOW)).toBe(true);
  });

  it("is false once the dish has been silent for a minute", () => {
    // The case the ping tile needs: an empty minute averages to zero drops,
    // which renders as 100% answered unless the emptiness is known separately.
    expect(hasRecentReadings(readings(NOW - 8 * 60_000, 60, 40), NOW)).toBe(false);
  });

  it("is false with no readings at all", () => {
    expect(hasRecentReadings([], NOW)).toBe(false);
  });
});
