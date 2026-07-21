import { describe, expect, it } from "vitest";
import { averageOf } from "./statDetails";
import type { TelemetrySample } from "./telemetry";

function sample(routerPingSuccessPercent: number | null): TelemetrySample {
  return {
    timestampMs: 0,
    latencyMs: 20,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 30,
    routerLatencyMs: null,
    routerPingSuccessPercent,
  };
}

describe("averageOf", () => {
  it("averages the readings that exist", () => {
    const samples = [sample(98), sample(null), sample(100)];
    expect(averageOf(samples, (s) => s.routerPingSuccessPercent)).toBe(99);
  });

  it("ignores fields a legacy seed left undefined, not just null", () => {
    // A historian that predates the router series serves samples without the
    // field at all; the seed casts them straight to TelemetrySample, so at
    // runtime getValue returns undefined. One such sample mixed with real
    // readings must not poison the average into NaN.
    const legacy = sample(null);
    delete (legacy as Partial<TelemetrySample>).routerPingSuccessPercent;
    const samples = [legacy, sample(98), sample(100)];
    expect(averageOf(samples, (s) => s.routerPingSuccessPercent)).toBe(99);
  });
});
