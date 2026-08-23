import { describe, it, expect } from "vitest";
import {
  routerStatus,
  dishStatus,
  formatUptime,
  formatAllowance,
  isUnlimited,
  dishDisplayName,
  allTimeUsage,
  isCycleReported,
  type CloudTerminal,
  type DeviceTelemetry,
  type UsageCycle,
} from "./starlinkCloud";

const now = Date.now();
const fresh: DeviceTelemetry = { kind: "router", timestampMs: now - 30_000 }; // 30s old — the cache's typical serving age
const stale: DeviceTelemetry = { kind: "router", timestampMs: now - 6 * 60 * 60 * 1000 }; // 6h old
// Late in a healthy device's ~2-minute upload cycle: nothing is wrong, its next
// report is simply not due yet. Measured cadence 2026-07-29 was 105-120s.
const midCycle: DeviceTelemetry = { kind: "router", timestampMs: now - 110_000 };

describe("routerStatus", () => {
  it("is online when telemetry is fresh", () => {
    expect(routerStatus(fresh)).toBe("online");
  });
  it("is offline when telemetry is stale", () => {
    expect(routerStatus(stale)).toBe("offline");
  });
  it("stays online late in the upload cycle, when no report is due yet", () => {
    // The bug this replaced: a 60s threshold against a ~2-minute cadence red-
    // dotted a healthy device for the back half of every single cycle.
    expect(routerStatus(midCycle)).toBe("online");
  });
  it("is inactive under a decommissioned dish, regardless of freshness", () => {
    // A router beneath a gray (inactive) dish must not show a red alarm.
    expect(routerStatus(fresh, true)).toBe("inactive");
    expect(routerStatus(undefined, true)).toBe("inactive");
  });
});

describe("LAN presence overrides cloud freshness", () => {
  it("is online when the LAN answers, however stale the cloud is", () => {
    expect(routerStatus(stale, false, true)).toBe("online");
    expect(routerStatus(undefined, false, true)).toBe("online");
  });
  it("is online when the LAN answers even under a decommissioned dish", () => {
    // Talking to us is proof it is still in service, whatever the account says.
    expect(routerStatus(stale, true, true)).toBe("online");
  });
  it("falls back to the cloud when the LAN is silent, rather than calling it offline", () => {
    // Away from the Starlink network nothing local answers, so silence must not
    // red a dish the cloud can see is fine.
    expect(routerStatus(fresh, false, false)).toBe("online");
    expect(routerStatus(stale, false, false)).toBe("offline");
  });
});

describe("dishStatus", () => {
  const recent = new Date(now - 60_000).toISOString();
  const longGone = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60d
  it("is inactive when not connected in over a month", () => {
    expect(dishStatus({ lastConnected: longGone } as CloudTerminal, fresh)).toBe("inactive");
  });
  it("is online with recent connection and fresh telemetry", () => {
    expect(dishStatus({ lastConnected: recent } as CloudTerminal, fresh)).toBe("online");
  });
  it("is offline with recent connection but stale telemetry", () => {
    expect(dishStatus({ lastConnected: recent } as CloudTerminal, stale)).toBe("offline");
  });
  it("stays online late in the upload cycle, when no report is due yet", () => {
    expect(dishStatus({ lastConnected: recent } as CloudTerminal, midCycle)).toBe("online");
  });
  it("is online when the LAN answers, outranking both staleness and inactivity", () => {
    expect(dishStatus({ lastConnected: recent } as CloudTerminal, stale, true)).toBe("online");
    expect(dishStatus({ lastConnected: longGone } as CloudTerminal, undefined, true)).toBe(
      "online",
    );
  });
});

describe("formatUptime", () => {
  it("formats across units", () => {
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(271)).toBe("4m 31s");
    expect(formatUptime(3600 + 27 * 60)).toBe("1h 27m");
    expect(formatUptime(90_000)).toBe("1d 1h");
  });
  it("returns a dash for missing/negative", () => {
    expect(formatUptime(undefined)).toBe("—");
    expect(formatUptime(-5)).toBe("—");
  });
});

describe("allowance / unlimited", () => {
  it("treats the 100 TB sentinel as unlimited", () => {
    expect(isUnlimited({ usageLimitGB: 100_000 })).toBe(true);
    expect(isUnlimited({ usageLimitGB: 500 })).toBe(false);
    expect(isUnlimited(undefined)).toBe(false);
  });
  it("formats an allowance in TB", () => {
    expect(formatAllowance(100_000)).toBe("100 TB");
    expect(formatAllowance(1500)).toBe("1.5 TB");
    expect(formatAllowance(undefined)).toBe("—");
  });
});

describe("dishDisplayName", () => {
  it("names by the last 6 hex of the terminal id, like the portal", () => {
    expect(dishDisplayName({ userTerminalId: "01000000-00000000-004c8bb9" } as CloudTerminal)).toBe(
      "STARLINK 4C8BB9",
    );
  });
});

describe("isCycleReported", () => {
  it("is false for a cycle carrying no days at all", () => {
    // What the feed sends for a cycle it has nothing for: 0 GB across 0 days.
    // That is an absence, not a measurement of zero.
    expect(
      isCycleReported({
        startDate: "2026-02-04T00:00:00+00:00",
        endDate: "2026-03-04T00:00:00+00:00",
        totalAmountGB: 0,
        dailyData: [],
      }),
    ).toBe(false);
  });

  it("is true for a cycle whose days really do add up to zero", () => {
    // A dish that was off all cycle genuinely used nothing. The days are there,
    // so the zero is a reading and must not be washed out as missing.
    expect(
      isCycleReported({
        startDate: "2026-02-04T00:00:00+00:00",
        endDate: "2026-03-04T00:00:00+00:00",
        totalAmountGB: 0,
        dailyData: [[0], [0], [0]],
      }),
    ).toBe(true);
  });

  it("is false when dailyData is missing entirely", () => {
    expect(isCycleReported({ dailyData: undefined } as unknown as UsageCycle)).toBe(false);
  });
});

describe("allTimeUsage", () => {
  /** A reported cycle: `days` of daily figures behind the total. */
  const cycle = (startDate: string, totalAmountGB: number, days = 1): UsageCycle => ({
    startDate,
    endDate: startDate,
    totalAmountGB,
    dailyData: Array.from({ length: days }, () => [0]),
  });

  /** A cycle the feed sent nothing for. */
  const unreported = (startDate: string): UsageCycle => ({
    startDate,
    endDate: startDate,
    totalAmountGB: 0,
    dailyData: [],
  });

  it("sums every reported cycle", () => {
    const summary = allTimeUsage([
      cycle("2026-03-04T00:00:00+00:00", 2495.966052108),
      cycle("2026-04-04T00:00:00+00:00", 4136.937441903),
      cycle("2026-05-04T00:00:00+00:00", 4333.455701169),
    ]);
    expect(summary.totalGB).toBeCloseTo(10966.35919518, 6);
    expect(summary.cycles).toBe(3);
  });

  it("reports the window it covers, so the figure is not read as all of history", () => {
    // The endpoint returns whatever span of cycles it chooses. Naming the first
    // one is what keeps "all time" an honest label rather than a claim about
    // every byte the account ever moved.
    const summary = allTimeUsage([
      cycle("2026-02-04T00:00:00+00:00", 3),
      cycle("2026-03-04T00:00:00+00:00", 12),
    ]);
    expect(summary.from).toBe("2026-02-04T00:00:00+00:00");
  });

  it("starts the span at the first cycle with data, not the first one listed", () => {
    // A service line whose opening cycle was never reported has no usage behind
    // that month. Dating the total from it would claim coverage that does not
    // exist.
    const summary = allTimeUsage([
      unreported("2026-02-04T00:00:00+00:00"),
      cycle("2026-03-04T00:00:00+00:00", 500),
    ]);
    expect(summary.from).toBe("2026-03-04T00:00:00+00:00");
  });

  it("counts only the cycles that were reported", () => {
    const summary = allTimeUsage([
      unreported("2026-02-04T00:00:00+00:00"),
      cycle("2026-03-04T00:00:00+00:00", 500),
      cycle("2026-04-04T00:00:00+00:00", 250),
    ]);
    expect(summary.totalGB).toBe(750);
    expect(summary.cycles).toBe(2);
    expect(summary.unreported).toBe(1);
  });

  it("keeps a genuine zero in the count and the span", () => {
    // Days present, all zero: the dish was off, and that is a real reading.
    const summary = allTimeUsage([
      cycle("2026-02-04T00:00:00+00:00", 0, 28),
      cycle("2026-03-04T00:00:00+00:00", 500),
    ]);
    expect(summary.cycles).toBe(2);
    expect(summary.unreported).toBe(0);
    expect(summary.from).toBe("2026-02-04T00:00:00+00:00");
  });

  it("is zero — never NaN — when no cycle has been reported", () => {
    const summary = allTimeUsage([]);
    expect(summary.totalGB).toBe(0);
    expect(summary.cycles).toBe(0);
    expect(summary.unreported).toBe(0);
    expect(summary.from).toBeNull();
  });

  it("skips a total that upstream sent as absent or non-numeric", () => {
    // Unvalidated JSON: one bad cycle must not turn the whole figure into NaN.
    const cycles = [
      cycle("2026-03-04T00:00:00+00:00", 100),
      { ...cycle("2026-04-04T00:00:00+00:00", 0), totalAmountGB: undefined },
      { ...cycle("2026-05-04T00:00:00+00:00", 0), totalAmountGB: Number.NaN },
      cycle("2026-06-04T00:00:00+00:00", 50),
    ] as unknown as UsageCycle[];
    expect(allTimeUsage(cycles).totalGB).toBe(150);
  });
});
