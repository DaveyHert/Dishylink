import { describe, expect, it } from "vitest";
import { buildUptimeSummary, UPTIME_WINDOW_DAYS } from "./uptimeSummary";
import type { OutageReport } from "./postmortem";

// A minimal OutageReport factory — only the fields buildUptimeSummary reads.
function report(
  startMs: number,
  endMs: number,
  id = `system:starlinkOutage:${startMs}`,
): OutageReport {
  return {
    id,
    source: "starlinkOutage",
    startMs,
    endMs,
    durationMs: endMs - startMs,
    cause: null,
    beforeDrop: {
      windowStartMs: startMs - 300_000,
      windowEndMs: startMs,
      coverageSeconds: 0,
      latencyAvgMs: null,
      downlinkAvgBps: null,
      uplinkAvgBps: null,
      dropRateAvg: null,
      heaterActive: false,
      source: "samples",
    },
    thermal: [],
    generatedAtMs: endMs,
  };
}

const NOW = new Date("2026-11-01T12:00:00Z").getTime();
const DAY = 24 * 3_600_000;
const WINDOW = UPTIME_WINDOW_DAYS * DAY;

describe("buildUptimeSummary", () => {
  it("returns 100 % uptime with no reports", () => {
    const summary = buildUptimeSummary([], NOW);
    expect(summary.uptimeFraction).toBe(1);
    expect(summary.uptimePercent).toBe("100.00 %");
    expect(summary.outageCount).toBe(0);
    expect(summary.mtbfMs).toBeNull();
    expect(summary.mttrMs).toBeNull();
  });

  it("calculates uptime correctly for a single 10-minute outage", () => {
    const outageMs = 10 * 60_000;
    const r = report(NOW - DAY, NOW - DAY + outageMs);
    const summary = buildUptimeSummary([r], NOW);
    const expectedFraction = 1 - outageMs / WINDOW;
    expect(summary.uptimeFraction).toBeCloseTo(expectedFraction, 6);
    expect(summary.outageCount).toBe(1);
    expect(summary.totalOutageMs).toBe(outageMs);
    expect(summary.mttrMs).toBe(outageMs);
    expect(summary.mtbfMs).toBeNull(); // only 1 outage
  });

  it("excludes reports outside the 30-day window", () => {
    const old = report(NOW - WINDOW - DAY, NOW - WINDOW - DAY + 60_000);
    const summary = buildUptimeSummary([old], NOW);
    expect(summary.outageCount).toBe(0);
    expect(summary.totalOutageMs).toBe(0);
  });

  it("clips an outage that started before the window", () => {
    const startMs = NOW - WINDOW - 3600_000; // 1 h before window
    const endMs = NOW - WINDOW + 3600_000; // 1 h into window
    const r = report(startMs, endMs);
    const summary = buildUptimeSummary([r], NOW);
    // Only the 1 h inside the window should be charged.
    expect(summary.totalOutageMs).toBeCloseTo(3600_000, -2);
    expect(summary.outageCount).toBe(1);
  });

  it("calculates MTBF for two outages", () => {
    const r1 = report(NOW - 10 * DAY, NOW - 10 * DAY + 60_000);
    const r2 = report(NOW - 5 * DAY, NOW - 5 * DAY + 60_000);
    const summary = buildUptimeSummary([r1, r2], NOW);
    expect(summary.mtbfMs).toBeCloseTo(5 * DAY, -3);
    expect(summary.mttrMs).toBe(60_000);
  });

  it("produces one day bucket per day in the window", () => {
    const summary = buildUptimeSummary([], NOW);
    expect(summary.days).toHaveLength(UPTIME_WINDOW_DAYS + 1); // +1: today
  });

  it("marks days before any reports as 'none'", () => {
    // A single report 2 days ago — days before that should be 'none'.
    const r = report(NOW - 2 * DAY, NOW - 2 * DAY + 60_000);
    const summary = buildUptimeSummary([r], NOW);
    const dayWithOutage = summary.days.find((d) => d.quality === "degraded" || d.quality === "poor");
    expect(dayWithOutage).toBeDefined();
    // Everything before the first report day should be "none".
    const firstReportIdx = summary.days.findIndex((d) => d.quality !== "none");
    for (let i = 0; i < firstReportIdx; i++) {
      expect(summary.days[i].quality).toBe("none");
    }
  });

  it("assigns 'perfect' quality to a recorded day with no outages", () => {
    // Report yesterday — today should be "perfect" (recorded, no outage).
    const r = report(NOW - DAY, NOW - DAY + 60_000);
    const summary = buildUptimeSummary([r], NOW);
    const today = summary.days[summary.days.length - 1];
    expect(today.quality).toBe("perfect");
  });

  it("assigns 'poor' quality to a day with > 10 min outage", () => {
    const midday = NOW - (NOW % DAY) + 6 * 3_600_000; // noon today (UTC approx)
    const r = report(midday - 12 * 60_000, midday); // 12 min outage
    const summary = buildUptimeSummary([r], NOW);
    const day = summary.days.find((d) => d.totalOutageMs > 0);
    expect(day?.quality).toBe("poor");
  });

  it("assigns 'degraded' quality to a day with 1–10 min outage", () => {
    const midday = NOW - (NOW % DAY) + 6 * 3_600_000;
    const r = report(midday - 5 * 60_000, midday); // 5 min outage
    const summary = buildUptimeSummary([r], NOW);
    const day = summary.days.find((d) => d.totalOutageMs > 0);
    expect(day?.quality).toBe("degraded");
  });

  it("assigns 'good' quality to a day with < 1 min outage", () => {
    const midday = NOW - (NOW % DAY) + 6 * 3_600_000;
    const r = report(midday - 30_000, midday); // 30 s outage
    const summary = buildUptimeSummary([r], NOW);
    const day = summary.days.find((d) => d.totalOutageMs > 0);
    expect(day?.quality).toBe("good");
  });
});
