import { describe, expect, it } from "vitest";
import type { AlertState } from "@core/alertDefinitions";
import { badgeAlerts, isBadgeMode } from "./badgeMode";

function alert(source: AlertState["source"], key: string): AlertState {
  return { source, key, active: true, ok: "", firing: "", severity: "warning" } as AlertState;
}

const DISH_FAULT = alert("dish", "thermalShutdown");
const ROUTER_FAULT = alert("router", "poeFuseBlown");
const DISH_UNREACHABLE = alert("system", "dishUnreachable");
const ROUTER_UNREACHABLE = alert("system", "routerUnreachable");
const OUTAGE = alert("system", "starlinkOutage");

describe("badgeAlerts", () => {
  it("counts faults and unreachability alike in the default mode", () => {
    const shown = badgeAlerts([DISH_FAULT, DISH_UNREACHABLE], "all");
    expect(shown).toHaveLength(2);
  });

  it("leaves Starlink outages out of every mode", () => {
    for (const mode of ["all", "faults"] as const) {
      expect(badgeAlerts([OUTAGE], mode)).toEqual([]);
    }
  });

  it("drops both unreachability keys in faults mode", () => {
    // Someone away from their kit sees exactly this pair and can act on neither.
    const shown = badgeAlerts([DISH_UNREACHABLE, ROUTER_UNREACHABLE], "faults");
    expect(shown).toEqual([]);
  });

  it("keeps what a device reported about itself in faults mode", () => {
    const shown = badgeAlerts([DISH_FAULT, ROUTER_FAULT, DISH_UNREACHABLE], "faults");
    expect(shown.map((a) => a.key)).toEqual(["thermalShutdown", "poeFuseBlown"]);
  });

  it("counts nothing at all when the badge is off", () => {
    expect(badgeAlerts([DISH_FAULT, ROUTER_FAULT], "off")).toEqual([]);
  });

  it("preserves the order it was given, so the worst still tints the badge", () => {
    const shown = badgeAlerts([ROUTER_FAULT, DISH_FAULT], "all");
    expect(shown[0]).toBe(ROUTER_FAULT);
  });

  it("counts the pair someone away from their kit is left with", () => {
    const away = [DISH_UNREACHABLE, ROUTER_UNREACHABLE];
    expect(badgeAlerts(away, "all")).toHaveLength(2);
    expect(badgeAlerts(away, "faults")).toHaveLength(0);
    expect(badgeAlerts(away, "off")).toHaveLength(0);
  });

  it("keeps a spent data allowance, which is actionable wherever you are", () => {
    const limit = alert("system", "dataLimit:aa:bb:cc");
    expect(badgeAlerts([limit], "faults")).toEqual([limit]);
  });

  it("counts nothing from an empty set in any mode", () => {
    for (const mode of ["all", "faults", "off"] as const) {
      expect(badgeAlerts([], mode)).toEqual([]);
    }
  });

  it("never invents an alert the caller did not pass", () => {
    const mixed = [DISH_FAULT, DISH_UNREACHABLE, ROUTER_UNREACHABLE, OUTAGE, ROUTER_FAULT];
    for (const mode of ["all", "faults", "off"] as const) {
      expect(badgeAlerts(mixed, mode).every((a) => mixed.includes(a))).toBe(true);
    }
  });

  it("narrows monotonically as the modes tighten", () => {
    const mixed = [DISH_FAULT, DISH_UNREACHABLE, ROUTER_UNREACHABLE, OUTAGE, ROUTER_FAULT];
    const all = badgeAlerts(mixed, "all");
    const faults = badgeAlerts(mixed, "faults");
    expect(faults.every((a) => all.includes(a))).toBe(true);
    expect(faults.length).toBeLessThan(all.length);
    expect(badgeAlerts(mixed, "off")).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const mixed = [DISH_FAULT, DISH_UNREACHABLE, OUTAGE];
    badgeAlerts(mixed, "faults");
    expect(mixed).toEqual([DISH_FAULT, DISH_UNREACHABLE, OUTAGE]);
  });
});

describe("isBadgeMode", () => {
  it("accepts the three modes and nothing else", () => {
    expect(["all", "faults", "off"].every(isBadgeMode)).toBe(true);
    for (const value of [undefined, null, "", "ALL", true, 1]) {
      expect(isBadgeMode(value)).toBe(false);
    }
  });
});
