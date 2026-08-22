import { describe, expect, it } from "vitest";
import type { DishStatusJson } from "./dishClient";
import { freshDownstreamRouterIds, routerPresence, routerSilenceExpected } from "./routerPresence";

/** The id the test kit reports, kept verbatim so the shapes below are the ones
 *  the dish actually sends. */
const ROUTER_ID = "Router-010000000000000001B31340";
const NOW = 1_787_345_200_000;

/** The dish stamps lastSeen in nanoseconds. */
function nsAgo(ms: number): string {
  return String((NOW - ms) * 1e6);
}

function status(
  downstream: Record<string, { role?: string; lastSeen?: string }> | undefined,
  connected?: string[],
): DishStatusJson {
  return { downstreamRouters: downstream, connectedRouters: connected } as DishStatusJson;
}

describe("routerPresence", () => {
  it("reads a working kit as present", () => {
    // Captured from a Gen 3 kit with bypass off, 2026-08-21.
    const dish = status({ [ROUTER_ID]: { role: "CONTROLLER", lastSeen: nsAgo(300) } });
    expect(routerPresence(dish, NOW)).toBe("present");
  });

  it("reads a bypassed kit as bypassed, not as absent", () => {
    // Captured from the same kit with bypass on: the entry stays and lastSeen
    // keeps refreshing, so an empty map is never the test for bypass.
    const dish = status({ [ROUTER_ID]: { role: "BYPASSED", lastSeen: nsAgo(838) } });
    expect(routerPresence(dish, NOW)).toBe("bypassed");
    expect(freshDownstreamRouterIds(dish, NOW)).toEqual([ROUTER_ID]);
  });

  it("reads a kit with no router at all as absent", () => {
    expect(routerPresence(status({}), NOW)).toBe("absent");
    expect(routerPresence(status(undefined), NOW)).toBe("absent");
    expect(routerPresence(null, NOW)).toBe("absent");
  });

  it("ignores a bypassed entry the dish has stopped refreshing", () => {
    // Past the freshness window the entry is no evidence of anything, so it must
    // not keep asserting bypass long after the map went stale.
    const dish = status({ [ROUTER_ID]: { role: "BYPASSED", lastSeen: nsAgo(120_000) } });
    expect(routerPresence(dish, NOW)).toBe("absent");
  });

  it("counts an entry the dish sent without a timestamp", () => {
    const dish = status({ [ROUTER_ID]: { role: "BYPASSED" } });
    expect(routerPresence(dish, NOW)).toBe("bypassed");
  });

  it("falls back to present when only the role-less list is sent", () => {
    // connectedRouters carries no roles, so bypass cannot be read from it.
    expect(routerPresence(status(undefined, [ROUTER_ID]), NOW)).toBe("present");
  });

  it("treats a mesh node alongside a bypassed controller as bypassed", () => {
    const dish = status({
      [ROUTER_ID]: { role: "BYPASSED", lastSeen: nsAgo(300) },
      "Router-mesh": { role: "MESH", lastSeen: nsAgo(300) },
    });
    expect(routerPresence(dish, NOW)).toBe("bypassed");
  });

  it("accepts whatever case the firmware sends the role in", () => {
    const dish = status({ [ROUTER_ID]: { role: "bypassed", lastSeen: nsAgo(300) } });
    expect(routerPresence(dish, NOW)).toBe("bypassed");
  });
});

describe("routerSilenceExpected", () => {
  it("excuses a router that was switched off or was never there", () => {
    expect(routerSilenceExpected("bypassed")).toBe(true);
    expect(routerSilenceExpected("absent")).toBe(true);
  });

  it("does not excuse a router that should be answering", () => {
    expect(routerSilenceExpected("present")).toBe(false);
  });

  it("has no opinion when the dish gave none", () => {
    // An unreachable dish is no evidence, so the unreachability still gets
    // raised — the dish's own alert is what tells the real story there.
    expect(routerSilenceExpected(null)).toBe(false);
  });
});
