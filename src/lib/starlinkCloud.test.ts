import { describe, it, expect } from "vitest";
import {
  routerStatus,
  dishStatus,
  formatUptime,
  formatAllowance,
  isUnlimited,
  dishDisplayName,
  type CloudTerminal,
  type DeviceTelemetry,
} from "./starlinkCloud";

const now = Date.now();
const fresh: DeviceTelemetry = { kind: "router", timestampMs: now - 30_000 }; // 30s old — the cache's typical serving age
const stale: DeviceTelemetry = { kind: "router", timestampMs: now - 6 * 60 * 60 * 1000 }; // 6h old

describe("routerStatus", () => {
  it("is online when telemetry is fresh", () => {
    expect(routerStatus(fresh)).toBe("online");
  });
  it("is offline when telemetry is stale", () => {
    expect(routerStatus(stale)).toBe("offline");
  });
  it("is inactive under a decommissioned dish, regardless of freshness", () => {
    // fix #4: a router beneath a gray (inactive) dish must not show a red alarm.
    expect(routerStatus(fresh, true)).toBe("inactive");
    expect(routerStatus(undefined, true)).toBe("inactive");
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
