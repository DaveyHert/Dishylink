// The router's latency rides along on the dish's samples rather than in a series
// of its own, because the router has no history ring to build one from. These
// cover the stamping rule that makes that honest: the reading lands only on the
// samples a poll actually appends, and its absence stays null rather than
// carrying a stale value forward.

import { describe, it, expect } from "vitest";
import {
  TelemetryAccumulator,
  decodeHistoryWindow,
  readRouterLatencyMs,
  readRouterPingSuccessPercent,
} from "@core/telemetry";
import type { DishHistoryJson } from "@core/dishClient";

/** A ring holding `count` samples, newest last, with the counter at `current`. */
function ring(count: number, current = count): DishHistoryJson {
  return {
    current: String(current),
    popPingLatencyMs: Array.from({ length: count }, () => 20),
    popPingDropRate: Array.from({ length: count }, () => 0),
    downlinkThroughputBps: Array.from({ length: count }, () => 1000),
    uplinkThroughputBps: Array.from({ length: count }, () => 500),
    powerIn: Array.from({ length: count }, () => 80),
  } as DishHistoryJson;
}

describe("decodeHistoryWindow", () => {
  it("leaves router latency null — the dish's ring says nothing about the router", () => {
    const { samples } = decodeHistoryWindow(ring(5), Date.now());
    expect(samples).toHaveLength(5);
    expect(samples.every((sample) => sample.routerLatencyMs === null)).toBe(true);
  });
});

// Retention is a duration. Any span comfortably wider than these fixtures does,
// since none of these cases is about ageing samples out.
const RETENTION_MS = 6 * 3_600_000;

describe("TelemetryAccumulator router latency stamping", () => {
  it("stamps the reading on every sample the poll appends", () => {
    const accumulator = new TelemetryAccumulator(RETENTION_MS);
    const samples = accumulator.ingest(ring(3), Date.now(), { latencyMs: 18.6 });
    expect(samples.map((sample) => sample.routerLatencyMs)).toEqual([18.6, 18.6, 18.6]);
  });

  it("leaves samples null when the router did not answer, rather than repeating the last reading", () => {
    const accumulator = new TelemetryAccumulator(RETENTION_MS);
    const nowMs = Date.now();
    accumulator.ingest(ring(2), nowMs, { latencyMs: 18.6 });
    // Next poll: two further samples, router unreachable.
    const samples = accumulator.ingest(ring(4), nowMs + 2000, {});

    expect(samples).toHaveLength(4);
    expect(samples.slice(0, 2).map((sample) => sample.routerLatencyMs)).toEqual([18.6, 18.6]);
    expect(samples.slice(2).map((sample) => sample.routerLatencyMs)).toEqual([null, null]);
  });

  it("does not backdate a reading onto samples recorded before it", () => {
    const accumulator = new TelemetryAccumulator(RETENTION_MS);
    const nowMs = Date.now();
    accumulator.ingest(ring(2), nowMs, {});
    const samples = accumulator.ingest(ring(3), nowMs + 1000, { latencyMs: 21.4 });

    // The first two predate the reading and must stay empty.
    expect(samples.slice(0, 2).map((sample) => sample.routerLatencyMs)).toEqual([null, null]);
    expect(samples[2].routerLatencyMs).toBe(21.4);
  });

  it("stamps ping success by the same rules, independently of latency", () => {
    const accumulator = new TelemetryAccumulator(RETENTION_MS);
    const nowMs = Date.now();
    accumulator.ingest(ring(2), nowMs, { latencyMs: 18.6, pingSuccessPercent: 98.11 });
    // Next poll: latency answered, ping success did not.
    const samples = accumulator.ingest(ring(4), nowMs + 2000, { latencyMs: 19.1 });

    expect(samples.slice(0, 2).map((sample) => sample.routerPingSuccessPercent)).toEqual([
      98.11, 98.11,
    ]);
    expect(samples.slice(2).map((sample) => sample.routerPingSuccessPercent)).toEqual([null, null]);
    expect(samples.slice(2).map((sample) => sample.routerLatencyMs)).toEqual([19.1, 19.1]);
  });
});

describe("readRouterLatencyMs", () => {
  it("passes a real reading through", () => {
    expect(readRouterLatencyMs(27.4)).toBe(27.4);
  });

  it("refuses everything that is not a measurement", () => {
    // proto3 omits a zero entirely, and toJson renders NaN as the string "NaN".
    expect(readRouterLatencyMs(undefined)).toBeNull();
    expect(readRouterLatencyMs(0)).toBeNull();
    expect(readRouterLatencyMs(Number.NaN)).toBeNull();
    expect(readRouterLatencyMs("NaN" as unknown as number)).toBeNull();
    expect(readRouterLatencyMs(-3)).toBeNull();
  });
});

describe("readRouterPingSuccessPercent", () => {
  it("turns a drop rate into the success percentage", () => {
    expect(readRouterPingSuccessPercent(0.02)).toBeCloseTo(98);
  });

  it("treats absence as the proto3 zero — no drops, not unsupported", () => {
    expect(readRouterPingSuccessPercent(undefined)).toBe(100);
    expect(readRouterPingSuccessPercent(0)).toBe(100);
  });

  it("refuses values that are not a rate", () => {
    expect(readRouterPingSuccessPercent(Number.NaN)).toBeNull();
    expect(readRouterPingSuccessPercent("NaN" as unknown as number)).toBeNull();
    expect(readRouterPingSuccessPercent(1.5)).toBeNull();
    expect(readRouterPingSuccessPercent(-0.1)).toBeNull();
  });
});
