// The post-mortem synthesis is the whole feature in miniature: inputs already
// recorded, folded into one self-contained report the moment an outage ends.
// These pin the rules that make a report honest: when the drop is dated from,
// which recording feeds the "five minutes before" numbers, what the heater
// state may assert, which dish event gets blamed, which thermal state counts
// as touching the outage, and which event row owns the report.

import { describe, expect, it } from "vitest";
import {
  BEFORE_WINDOW_MS,
  buildOutageReport,
  assignReports,
  type OutageReport,
  type OutageReportInput,
} from "./postmortem";
import type { MinuteBucket } from "./energyBuckets";
import type { OutageEvent, TelemetrySample } from "./telemetry";

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

function event(startMs: number, durationMs: number, cause: string): OutageEvent {
  return { startMs, durationMs, cause, severity: "warning" };
}

function input(overrides: Partial<OutageReportInput> = {}): OutageReportInput {
  return {
    source: "starlinkOutage",
    startMs: START,
    endMs: END,
    generatedAtMs: END + 1000,
    dishEvents: [event(START - 2_000, 185_000, "EVENT_REASON_OUTAGE_NO_PINGS")],
    samples: fullWindow(),
    minuteBuckets: [],
    dishAlerts: [],
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

describe("when the drop is dated from", () => {
  it("backs the start up to the first dropped sample of the run the recorder noticed late", () => {
    // The recorder stamps the episode eight dropped seconds in; the run of
    // fully dropped samples ending at that stamp began at the drop itself.
    const window = fullWindow();
    for (let second = 292; second < 300; second += 1) {
      window[second] = sample(window[second].timestampMs, { dropRate: 1 });
    }
    const report = buildOutageReport(input({ samples: window }));
    expect(report.startMs).toBe(START - 8_000);
    expect(report.durationMs).toBe(188_000);
    // The window moves with it, so the dropped seconds are not in the averages.
    expect(report.beforeDrop.windowEndMs).toBe(START - 8_000);
    expect(report.beforeDrop.dropRateAvg).toBe(0);
    // The identity stays the episode's own stamp.
    expect(report.id).toBe(`system:starlinkOutage:${START}`);
  });

  it("stops at the first sample that still had pings", () => {
    const window = fullWindow();
    window[298] = sample(window[298].timestampMs, { dropRate: 1 });
    window[299] = sample(window[299].timestampMs, { dropRate: 1 });
    window[290] = sample(window[290].timestampMs, { dropRate: 1 }); // separate blip
    expect(buildOutageReport(input({ samples: window })).startMs).toBe(START - 2_000);
  });

  it("keeps a dish-unreachable episode's own stamp: there are no samples to date it from", () => {
    const window = fullWindow();
    window[299] = sample(window[299].timestampMs, { dropRate: 1 });
    const report = buildOutageReport(input({ source: "dishUnreachable", samples: window }));
    expect(report.startMs).toBe(START);
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
    expect(report.beforeDrop.latencyAvgMs).toBe(40);
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
        minuteBuckets: Array.from({ length: 5 }, (_, i) =>
          bucket(WINDOW_START / 1000 + i * 60, 60, 6e9),
        ),
      }),
    );
    expect(report.beforeDrop).toMatchObject({
      coverageSeconds: 300,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      latencyAvgMs: null,
      dropRateAvg: null,
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

  it("excludes the whole-minute bucket the drop second falls in, however the caller asked", () => {
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
          ...Array.from({ length: 4 }, (_, i) => bucket(dropMinuteSec - (i + 1) * 60, 60, 6e9)),
          bucket(dropMinuteSec, 60, 297e9),
        ],
      }),
    );
    expect(report.beforeDrop.coverageSeconds).toBe(240);
    expect(report.beforeDrop.downlinkAvgBps).toBe(100_000_000);
  });
});

describe("the heater", () => {
  it("was running when an isHeating episode overlaps the window", () => {
    const report = buildOutageReport(
      input({
        dishAlerts: [{ alertKey: "isHeating", startMs: START - 120_000, endMs: START - 60_000 }],
      }),
    );
    expect(report.beforeDrop.heaterActive).toBe(true);
  });

  it("counts one still running at generation time", () => {
    const report = buildOutageReport(
      input({ dishAlerts: [{ alertKey: "isHeating", startMs: START - 10_000, endMs: null }] }),
    );
    expect(report.beforeDrop.heaterActive).toBe(true);
  });

  it("was off when no episode touches the window", () => {
    const report = buildOutageReport(
      input({
        dishAlerts: [
          { alertKey: "isHeating", startMs: WINDOW_START - 600_000, endMs: WINDOW_START - 1 },
          { alertKey: "isHeating", startMs: START + 1, endMs: null },
        ],
      }),
    );
    expect(report.beforeDrop.heaterActive).toBe(false);
  });
});

describe("the cause", () => {
  it("takes the canonical cause of the dish event overlapping the outage", () => {
    expect(buildOutageReport(input()).cause).toBe("NO_PINGS");
  });

  it("reports no cause when the dish never logged an overlapping event", () => {
    expect(buildOutageReport(input({ dishEvents: [] })).cause).toBeNull();
  });

  it("does not blame an event that ended minutes before the drop", () => {
    const report = buildOutageReport(
      input({ dishEvents: [event(START - 240_000, 30_000, "EVENT_REASON_OUTAGE_OBSTRUCTED")] }),
    );
    expect(report.cause).toBeNull();
  });

  it("ties to the event whose start is nearest the drop", () => {
    const report = buildOutageReport(
      input({
        dishEvents: [
          event(START - 240_000, 300_000, "EVENT_REASON_OUTAGE_OBSTRUCTED"),
          event(START - 1_000, 181_000, "EVENT_REASON_OUTAGE_NO_PINGS"),
        ],
      }),
    );
    expect(report.cause).toBe("NO_PINGS");
  });
});

describe("thermal state touching the outage", () => {
  it("includes thermal episodes overlapping the window widened five minutes before the drop", () => {
    const report = buildOutageReport(
      input({
        dishAlerts: [
          // Ended four minutes before the window began.
          { alertKey: "thermalThrottle", startMs: START - 600_000, endMs: START - 480_000 },
          // Began inside the widened window and ran into the outage.
          { alertKey: "thermalShutdown", startMs: START - 240_000, endMs: END + 30_000 },
          // Still running at generation time, frozen as it was.
          { alertKey: "powerSupplyThermalThrottle", startMs: START - 30_000, endMs: null },
          // Not a thermal key.
          { alertKey: "isHeating", startMs: START - 30_000, endMs: null },
        ],
      }),
    );
    expect(report.thermal.map((episode) => episode.alertKey)).toEqual([
      "thermalShutdown",
      "powerSupplyThermalThrottle",
    ]);
  });
});

describe("which event row owns a report", () => {
  const report = buildOutageReport(input());
  const other: OutageReport = {
    ...report,
    id: "other",
    startMs: END + 600_000,
    endMs: END + 660_000,
  };

  const NO_PINGS = "EVENT_REASON_OUTAGE_NO_PINGS";

  it("gives the report to the outage event whose span overlaps it", () => {
    const outage = event(START - 2_000, 185_000, NO_PINGS);
    const { byEvent, unclaimed } = assignReports([other, report], [outage]);
    expect(byEvent.get(outage)).toBe(report);
    expect(unclaimed).toEqual([other]);
  });

  it("tolerates the dish stamping the event a little before the recorder noticed", () => {
    const outage = event(START - 20_000, 5_000, NO_PINGS);
    expect(assignReports([report], [outage]).byEvent.get(outage)).toBe(report);
  });

  it("never hands an outage's figures to a band switch, a router ping drop or a thermal row inside it", () => {
    const bandSwitch = event(START + 30_000, 0, "EVENT_REASON_CLIENT_SWITCHING_BAND");
    const routerDrop = event(START + 10_000, 40_000, "EVENT_REASON_ROUTER_POP_IPV4_PING_DROP");
    const thermal = event(START - 60_000, 300_000, "thermal throttle");
    const outage = event(START - 2_000, 185_000, NO_PINGS);
    const { byEvent } = assignReports([report], [bandSwitch, routerDrop, thermal, outage]);
    expect(byEvent.get(bandSwitch)).toBeUndefined();
    expect(byEvent.get(routerDrop)).toBeUndefined();
    expect(byEvent.get(thermal)).toBeUndefined();
    expect(byEvent.get(outage)).toBe(report);
  });

  it("gives one report to one row: the outage event starting nearest the drop", () => {
    const near = event(START - 1_000, 181_000, NO_PINGS);
    const far = event(START + 90_000, 5_000, "EVENT_REASON_OUTAGE_NO_DOWNLINK");
    const { byEvent } = assignReports([report], [far, near]);
    expect(byEvent.get(near)).toBe(report);
    expect(byEvent.get(far)).toBeUndefined();
  });

  it("leaves a report no outage event overlaps to a row of its own", () => {
    const bandSwitch = event(START + 30_000, 0, "EVENT_REASON_CLIENT_SWITCHING_BAND");
    const { byEvent, unclaimed } = assignReports([report], [bandSwitch]);
    expect(byEvent.size).toBe(0);
    expect(unclaimed).toEqual([report]);
  });
});
