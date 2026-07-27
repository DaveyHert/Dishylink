import { describe, expect, it } from "vitest";
import { averageOf, coverageNote } from "./statDetails";
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

describe("coverageNote", () => {
  const NOW = 1_784_400_000_000;

  /** `count` samples at 1 Hz ending `endMs`. */
  function run(endMs: number, count: number): TelemetrySample[] {
    return Array.from({ length: count }, (_, index) => ({
      timestampMs: endMs - (count - 1 - index) * 1000,
      latencyMs: 40,
      dropRate: 0,
      downlinkBps: 0,
      uplinkBps: 0,
      powerW: 30,
      routerLatencyMs: null,
      routerPingSuccessPercent: null,
    }));
  }

  it("reports a fully recorded window as covered", () => {
    expect(coverageNote(run(NOW, 901), 15)).toBe("over the selected window");
  });

  it("counts a gap as missing rather than reporting the full span", () => {
    // 5 minutes, a 5-minute outage, 5 more minutes: 15 minutes wide, 10 recorded.
    const samples = [...run(NOW - 10 * 60_000, 300), ...run(NOW, 300)];
    expect(coverageNote(samples, 15)).toBe("recorded 10 min of this window");
  });

  it("counts a window that readings stopped partway through as partial", () => {
    // Recording ran 5 minutes then stopped; the rest of the window is an outage
    // still in progress. Span first-to-last is 5 min and so is the coverage.
    expect(coverageNote(run(NOW - 10 * 60_000, 300), 15)).toBe("recorded 5 min of this window");
  });

  it("does not treat a few dropped 1 Hz readings as an outage", () => {
    const samples = run(NOW, 901);
    samples.splice(400, 2);
    expect(coverageNote(samples, 15)).toBe("over the selected window");
  });

  it("names an empty window as unrecorded rather than as a short session", () => {
    // A dish silent for longer than the window leaves nothing inside it. "not
    // enough data yet" would read as a session that just started.
    expect(coverageNote([], 15)).toBe("nothing recorded in this window");
  });

  it("reports a lone reading as under a minute rather than as no data", () => {
    expect(coverageNote(run(NOW, 1), 15)).toBe("recorded < 1 min of this window");
  });
});
