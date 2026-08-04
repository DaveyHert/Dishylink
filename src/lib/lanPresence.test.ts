import { describe, it, expect } from "vitest";
import { dishSeesRouter, lanOnlineDeviceIds } from "./lanPresence";

// The real ids, as measured on 2026-07-29 — LAN deviceInfo.id and cloud
// DeviceId are the same string on both device kinds, which is what lets the
// account panel join the two without translating.
const DISH = "ut0158168c-42207c02-5946ca71";
const MAIN_ROUTER = "Router-010000000000000001B31340";
const MESH = "Router-01000000000000000049375B";

const NOW = Date.parse("2026-07-29T12:00:00Z");
const nsAt = (msAgo: number) => String((NOW - msAgo) * 1e6);

const base = {
  dish: null,
  dishReachable: false,
  router: null,
  routerReachable: false,
  nowMs: NOW,
};

describe("lanOnlineDeviceIds", () => {
  it("is empty away from the Starlink network", () => {
    // Nothing answers, so the panel has no local opinion and every dot falls
    // back to cloud freshness rather than going red.
    expect(lanOnlineDeviceIds(base).size).toBe(0);
  });

  it("reports the dish and its controller from one dish reply", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      dish: {
        deviceInfo: { id: DISH },
        downstreamRouters: { [MAIN_ROUTER]: { role: "CONTROLLER", lastSeen: nsAt(2_000) } },
      },
      dishReachable: true,
    });
    expect([...present].sort()).toEqual([MAIN_ROUTER, DISH].sort());
  });

  it("omits a mesh node the dish has dropped", () => {
    // A node that is genuinely down disappears from downstreamRouters, so it
    // gets no local vote and the cloud correctly reds it.
    const present = lanOnlineDeviceIds({
      ...base,
      dish: {
        deviceInfo: { id: DISH },
        downstreamRouters: { [MAIN_ROUTER]: { lastSeen: nsAt(2_000) } },
      },
      dishReachable: true,
    });
    expect(present.has(MESH)).toBe(false);
  });

  it("omits a downstream entry that outlived its link", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      dish: {
        deviceInfo: { id: DISH },
        downstreamRouters: { [MESH]: { lastSeen: nsAt(10 * 60_000) } },
      },
      dishReachable: true,
    });
    expect(present.has(MESH)).toBe(false);
    expect(present.has(DISH)).toBe(true);
  });

  it("keeps a downstream entry whose timestamp is missing or unreadable", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      dish: {
        deviceInfo: { id: DISH },
        downstreamRouters: { [MAIN_ROUTER]: {}, [MESH]: { lastSeen: "not-a-number" } },
      },
      dishReachable: true,
    });
    expect(present.has(MAIN_ROUTER)).toBe(true);
    expect(present.has(MESH)).toBe(true);
  });

  it("falls back to connectedRouters only when the timestamped map is absent", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      dish: { deviceInfo: { id: DISH }, connectedRouters: [MAIN_ROUTER] },
      dishReachable: true,
    });
    expect(present.has(MAIN_ROUTER)).toBe(true);
  });

  it("does not let connectedRouters resurrect a router lastSeen ruled out", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      dish: {
        deviceInfo: { id: DISH },
        connectedRouters: [MESH],
        downstreamRouters: { [MESH]: { lastSeen: nsAt(10 * 60_000) } },
      },
      dishReachable: true,
    });
    expect(present.has(MESH)).toBe(false);
  });

  it("ignores a remembered reply once the poll stops succeeding", () => {
    // Both feeds hold their last payload through a failure so other surfaces can
    // caveat rather than blank; presence must read the reachable flag, not the
    // leftover reply, or an unplugged dish would stay green forever.
    const dish = {
      deviceInfo: { id: DISH },
      downstreamRouters: { [MAIN_ROUTER]: { lastSeen: nsAt(2_000) } },
    };
    expect(lanOnlineDeviceIds({ ...base, dish, dishReachable: false }).size).toBe(0);
    expect(
      lanOnlineDeviceIds({
        ...base,
        router: { deviceInfo: { id: MAIN_ROUTER } },
        routerReachable: false,
      }).size,
    ).toBe(0);
  });

  it("reports the router from its own reply when the dish is unreachable", () => {
    const present = lanOnlineDeviceIds({
      ...base,
      router: { deviceInfo: { id: MAIN_ROUTER } },
      routerReachable: true,
    });
    expect([...present]).toEqual([MAIN_ROUTER]);
  });
});

describe("dishSeesRouter", () => {
  it("vouches for a router the dish reports, whether or not we can reach it", () => {
    // The signal that separates "a router exists and something is in the way"
    // from "this kit has no router" — see lib/routerDiagnosis.
    const dish = { downstreamRouters: { [MAIN_ROUTER]: { lastSeen: nsAt(2_000) } } };
    expect(dishSeesRouter(dish, true, NOW)).toBe(true);
  });

  it("does not vouch for a router the dish has stopped hearing from", () => {
    const dish = { downstreamRouters: { [MAIN_ROUTER]: { lastSeen: nsAt(10 * 60_000) } } };
    expect(dishSeesRouter(dish, true, NOW)).toBe(false);
  });

  it("has no opinion when the dish itself is not answering", () => {
    // A silent dish is not evidence that the kit has no router.
    const dish = { downstreamRouters: { [MAIN_ROUTER]: { lastSeen: nsAt(2_000) } } };
    expect(dishSeesRouter(dish, false, NOW)).toBe(false);
    expect(dishSeesRouter(null, true, NOW)).toBe(false);
  });

  it("accepts the untimestamped fallback list", () => {
    expect(dishSeesRouter({ connectedRouters: [MAIN_ROUTER] }, true, NOW)).toBe(true);
    expect(dishSeesRouter({ connectedRouters: [] }, true, NOW)).toBe(false);
  });
});
