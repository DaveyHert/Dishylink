// The accumulator holds a span of clock, so an outage takes up room in the buffer
// rather than being pushed out of it by the readings either side. That is what lets
// a six-hour buffer answer questions about six hours: when the dish went quiet for
// five of them, the silence is most of the answer.

import { describe, it, expect } from "vitest";
import { TelemetryAccumulator } from "@core/telemetry";
import type { TelemetrySample } from "@core/telemetry";

const HOUR_MS = 3_600_000;

/** `count` readings at 1 Hz, newest at `endMs`. */
function readings(endMs: number, count: number): TelemetrySample[] {
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: endMs - (count - 1 - index) * 1000,
    latencyMs: 20,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 30,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  }));
}

describe("TelemetryAccumulator retention", () => {
  it("keeps six hours of clock when it holds twelve hours of readings", () => {
    const nowMs = Date.now();
    const accumulator = new TelemetryAccumulator(6 * HOUR_MS);
    // Two hours recorded, an eight-hour outage, two hours recorded: four hours
    // of readings spread across twelve hours of clock. Six hours back from the
    // newest reading reaches only the second stretch.
    const seeded = accumulator.seed([
      ...readings(nowMs - 10 * HOUR_MS, 7200),
      ...readings(nowMs, 7200),
    ]);

    expect(seeded).toHaveLength(7200);
    expect(nowMs - seeded[0].timestampMs).toBeLessThanOrEqual(6 * HOUR_MS);
  });

  it("keeps everything inside the window, however sparse", () => {
    const nowMs = Date.now();
    const accumulator = new TelemetryAccumulator(6 * HOUR_MS);
    const seeded = accumulator.seed([...readings(nowMs - 5 * HOUR_MS, 60), ...readings(nowMs, 60)]);

    expect(seeded).toHaveLength(120);
  });

  it("restores a snapshot written a day ago intact", () => {
    // A snapshot is entirely in the past, and a machine that was off overnight
    // reads one that is a day old. Six hours back from the wall clock reaches
    // none of it, which would empty the charts on the restore meant to fill them.
    const archivedEndMs = Date.now() - 24 * HOUR_MS;
    const accumulator = new TelemetryAccumulator(6 * HOUR_MS);

    expect(accumulator.seed(readings(archivedEndMs, 3600))).toHaveLength(3600);
  });
});
