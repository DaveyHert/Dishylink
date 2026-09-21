// The post-mortem synthesis is the whole feature in miniature: inputs already
// recorded, folded into one self-contained report the moment an outage ends.
// These pin the rules that make a report honest — which recording feeds the
// "five minutes before" numbers, what "snow melt" may assert, which dish event
// gets blamed, and what thermal state counts as touching the outage.

import { describe, expect, it } from "vitest";
import { BEFORE_WINDOW_MS, buildOutageReport, type OutageReportInput } from "./postmortem";
import type { MinuteBucket } from "./energyBuckets";
import type { TelemetrySample } from "./telemetry";

const START = 1_785_000_000_000; // arbitrary epoch ms
const END = START + 180_000;
const WINDOW_START = START - BEFORE_WINDOW_MS;

function sample(timestampMs: number, overrides: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    timestampMs,
    latencyMs: 40,
    dropRate: 0,
    downlinkBps: 100_000_000,
    uplinkBps: 10_000_000,
    powerW: 80,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
    snowMeltActive: null,
    ...overrides,
  };
}

/** A fully covered five-minute window at 1 Hz, ending at the drop. */
function fullWindow(): TelemetrySample[] {
  return Array.from({ length: 300 }, (_, second) => sample(WINDOW_START + second * 1000));
}

function bucket(minuteSec: number, samples = 60, downlinkBits = 6e9): MinuteBucket {
  return { minute: minuteSec, wattSeconds: samples * 80, samples, downlinkBits, uplinkBits: 6e8 };
}

function input(overrides: Partial<OutageReportInput> = {}): OutageReportInput {
  return {
    source: "starlinkOutage",
    startMs: START,
    endMs: END,
    generatedAtMs: END + 1000,
    dishEvents: [
      {
        startMs: START - 2_000,
        durationMs: 185_000,
        cause: "EVENT_REASON_OUTAGE_NO_PINGS",
        severity: "warning",
      },
    ],
    samples: fullWindow(),
    minuteBuckets: [],
    thermal: [],
    ...overrides,
  };
}

describe("buildOutageReport identity", () => {
  it("keys the report to the episode and states its span", () => {
    const report = buildOutageReport(input());
    expect(report.id).toBe(`system:starlinkOutage:${START}`);
    expect(report.startMs).toBe(START);
    expect(report.endMs).toBe(END);
    expect(report.durationMs).toBe(180_000);
    expect(report.source).toBe("starlinkOutage");
  });
});

describe("the five minutes before the drop", () => {
  it("averages the 1 s samples that cover the window", () => {
    const report = buildOutageReport(input());
    expect(report.beforeDrop).toMatchObject({
      windowStartMs: WINDOW_START,
      windowEndMs: START,
      coverageSeconds: 300,
      latencyAvgMs: 40,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      dropRateAvg: 0,
      source: "samples",
    });
  });

  it("drops null latencies from the mean instead of averaging them in", () => {
    const window = fullWindow();
    window[0] = sample(WINDOW_START, { latencyMs: null });
    window[1] = sample(WINDOW_START + 1000, { latencyMs: null });
    const report = buildOutageReport(input({ samples: window }));
    expect(report.beforeDrop.latencyAvgMs).toBe(40); // 298 readings, not 300/300 count
  });

  it("reports the honesty number when the window is only partly covered", () => {
    // The recorder restarted two minutes into the window: seconds 120–300 only.
    const window = Array.from({ length: 180 }, (_, second) =>
      sample(WINDOW_START + (120 + second) * 1000),
    );
    const report = buildOutageReport(input({ samples: window }));
    expect(report.beforeDrop.coverageSeconds).toBe(180);
    expect(report.beforeDrop.source).toBe("samples");
  });

  it("falls back to the per-minute rows once the window has aged past the samples", () => {
    const report = buildOutageReport(
      input({
        samples: [],
        minuteBuckets: [
          bucket(WINDOW_START / 1000, 60, 6e9),
          bucket(WINDOW_START / 1000 + 60, 60, 6e9),
          bucket(WINDOW_START / 1000 + 120, 60, 6e9),
          bucket(WINDOW_START / 1000 + 180, 60, 6e9),
          bucket(WINDOW_START / 1000 + 240, 60, 6e9),
        ],
      }),
    );
    expect(report.beforeDrop).toMatchObject({
      coverageSeconds: 300,
      // 30 Gb over 300 recorded seconds — the minute rows have no latency.
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      latencyAvgMs: null,
      dropRateAvg: null,
      snowMelt: "unknown",
      source: "minute-buckets",
    });
  });

  it("handles an outage nobody recorded around: coverage zero, no invented numbers", () => {
    const report = buildOutageReport(input({ samples: [], minuteBuckets: [] }));
    expect(report.beforeDrop).toMatchObject({
      coverageSeconds: 0,
      latencyAvgMs: null,
      downlinkAvgBps: null,
      uplinkAvgBps: null,
      source: "minute-buckets",
    });
  });

  it("ignores the whole-minute bucket the drop second falls in", () => {
    // The drop minute mixes pre-drop and dropped seconds; only the minutes
    // whose start lies inside the window count. The window spans 11:55:00–12:00:00.
    const dropMinuteSec = Math.floor(START / 60_000) * 60;
    const report = buildOutageReport(
      input({
        samples: [],
        minuteBuckets: [
          bucket(WINDOW_START / 1000, 60, 6e9),
          ...Array.from({ length: 4 }, (_, i) =>
            bucket(WINDOW_START / 1000 + (i + 1) * 60, 60, 6e9),
          ),
          bucket(dropMinuteSec, 60, 6e9), // must not count — it covers the drop second
        ],
      }),
    );
    expect(report.beforeDrop.coverageSeconds).toBe(300);
    expect(report.beforeDrop.downlinkAvgBps).toBe(100_000_000);
  });

  it("excludes the drop-second bucket even when the caller hands it in — the drop rarely lands on a minute boundary", () => {
    // Drop at :37 of the minute: the drop-minute bucket starts before the drop
    // stamp, so a naive `bucket.minute < startMs` cut would let it through and
    // average its mixed pre-drop/dropped seconds.
    const startMs = START + 37_000;
    const dropMinuteSec = Math.floor(startMs / 60_000) * 60;
    const report = buildOutageReport(
      input({
        startMs,
        endMs: startMs + 180_000,
        samples: [],
        minuteBuckets: [
          bucket(dropMinuteSec - 60, 60, 6e9),
          bucket(dropMinuteSec - 120, 60, 6e9),
          bucket(dropMinuteSec - 180, 60, 6e9),
          bucket(dropMinuteSec - 240, 60, 6e9),
          // The drop minute, with a volume that would skew the average if it leaked in.
          bucket(dropMinuteSec, 60, 297e9),
        ],
      }),
    );
    expect(report.beforeDrop.coverageSeconds).toBe(240);
    expect(report.beforeDrop.downlinkAvgBps).toBe(100_000_000);
  });
});

describe("snow melt — what may be asserted", () => {
  it("says active when any sample in the window was stamped active", () => {
    const window = fullWindow();
    window[150] = sample(window[150].timestampMs, { snowMeltActive: true });
    expect(buildOutageReport(input({ samples: window })).beforeDrop.snowMelt).toBe("active");
  });

  it("reports unknown for recorded falses too — the producer never emits them, so 'off' would be an invention", () => {
    const report = buildOutageReport(
      input({
        samples: fullWindow().map((s) => ({ ...s, snowMeltActive: false })),
      }),
    );
    expect(report.beforeDrop.snowMelt).toBe("unknown");
  });

  it("says unknown when the reply never asserted anything — the field is absent while false", () => {
    const report = buildOutageReport(input({ samples: fullWindow() }));
    expect(report.beforeDrop.snowMelt).toBe("unknown");
  });
});

describe("the cause", () => {
  it("takes the canonical cause of the dish event overlapping the outage", () => {
    const report = buildOutageReport(input());
    expect(report.cause).toBe("NO_PINGS");
  });

  it("reports no cause when the dish never logged an overlapping event", () => {
    const report = buildOutageReport(input({ dishEvents: [] }));
    expect(report.cause).toBeNull();
  });

  it("ties to the event whose start is nearest the recorder's start stamp", () => {
    // Both overlap: one begins 4 min before the drop (a slow bleed), one 1 s
    // before — the recorder's start matches the sudden one, which is the cause.
    const report = buildOutageReport(
      input({
        dishEvents: [
          {
            startMs: START - 240_000,
            durationMs: 300_000,
            cause: "EVENT_REASON_OUTAGE_OBSTRUCTED",
            severity: "warning",
          },
          {
            startMs: START - 1_000,
            durationMs: 181_000,
            cause: "EVENT_REASON_OUTAGE_NO_PINGS",
            severity: "warning",
          },
        ],
      }),
    );
    expect(report.cause).toBe("NO_PINGS");
  });
});

describe("thermal state touching the outage", () => {
  it("includes episodes that overlap the window widened five minutes before the drop", () => {
    const report = buildOutageReport(
      input({
        thermal: [
          // Ended four minutes before the drop — before the widened window.
          { alertKey: "thermalThrottle", startMs: START - 600_000, endMs: START - 480_000 },
          // Began inside the widened window and ran into the outage.
          { alertKey: "thermalShutdown", startMs: START - 240_000, endMs: END + 30_000 },
          // Still running at generation time — frozen as it was.
          { alertKey: "powerSupplyThermalThrottle", startMs: START - 30_000, endMs: null },
        ],
      }),
    );
    expect(report.thermal.map((episode) => episode.alertKey)).toEqual([
      "thermalShutdown",
      "powerSupplyThermalThrottle",
    ]);
  });
});
