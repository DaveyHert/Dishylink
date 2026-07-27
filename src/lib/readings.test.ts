// The stat tiles report what the dish is doing now, so their spans are cut from
// the clock. A dish that stops answering stops appending samples, and a span
// counted in readings would sit on the last healthy minute and present it as the
// current one — a tile reading 100% ping success with the dish unreachable.

import { describe, it, expect } from "vitest";
import { latestReading, recentAverage, sparklineFrom, hasRecentReadings } from "./readings";
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

describe("latestReading", () => {
  it("reports the newest reading while the dish is answering", () => {
    expect(latestReading(readings(NOW, 10, 25), (s) => s.powerW, NOW)).toBe(25);
  });

  it("reports nothing once the newest reading is seconds stale", () => {
    const stale = readings(NOW - 60_000, 10, 25);
    expect(latestReading(stale, (s) => s.powerW, NOW)).toBe(0);
  });

  it("still looks back a few seconds for a real value", () => {
    // A dropped ring entry decodes as 0; the one before it is the live reading.
    const samples = readings(NOW, 4, 25);
    samples[samples.length - 1].powerW = 0;
    expect(latestReading(samples, (s) => s.powerW, NOW)).toBe(25);
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
