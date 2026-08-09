import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildDeviceList } from "./deviceList";
import { lanOnlineDeviceIds } from "../../lib/lanPresence";
import type { CloudTerminal, DeviceTelemetry } from "../../lib/starlinkCloud";

// Real ids and real shapes, captured from this account on 2026-07-29: the cloud
// telemetry keys, the dish's own get_status reply, and the LAN device ids. The
// point of the fixture is the join — the account list is keyed on cloud ids and
// LAN presence arrives keyed on device ids, and the two only line up because
// they are the same strings.
const DISH = "ut0158168c-42207c02-5946ca71";
const MAIN_ROUTER = "Router-010000000000000001B31340";
const MESH = "Router-01000000000000000049375B";

const NOW = Date.parse("2026-07-29T12:00:00Z");

const terminals: CloudTerminal[] = [
  {
    userTerminalId: "0158168c-42207c02-5946ca71",
    lastConnected: "2026-07-14T00:00:00Z",
    routers: [{ routerId: "010000000000000001B31340" }, { routerId: "01000000000000000049375B" }],
  } as CloudTerminal,
];

/** Mid-upload-cycle telemetry: healthy, simply not due to report again yet.
 *  110s matches the 105-120s cadence measured on these very devices. */
const midCycle = (kind: "dish" | "router"): DeviceTelemetry =>
  ({ kind, timestampMs: NOW - 110_000 }) as DeviceTelemetry;

const cloudMidCycle: Record<string, DeviceTelemetry> = {
  [DISH]: midCycle("dish"),
  [MAIN_ROUTER]: midCycle("router"),
  // Dark for 2.7 days, exactly as measured.
  [MESH]: { kind: "router", timestampMs: NOW - 235_472_000 } as DeviceTelemetry,
};

// Looked up by the item's stable key (the terminal/router id), not its display
// name: both routers here render the same name until telemetry marks one a
// repeater, so a name match would silently read the wrong row.
const DISH_KEY = "0158168c-42207c02-5946ca71";
const MAIN_ROUTER_KEY = "010000000000000001B31340";
const MESH_KEY = "01000000000000000049375B";

const statusOf = (items: ReturnType<typeof buildDeviceList>, key: string) =>
  items.find((item) => item.key === key)?.status;

describe("buildDeviceList status, joined against LAN presence", () => {
  // The status helpers read the wall clock, and every age in this fixture is
  // stated relative to the capture instant, so the clock is pinned to it.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("greens the dish and controller mid-cycle, and only reds the dead mesh", () => {
    // With a sub-cadence freshness window, these two would read offline for the
    // back half of every upload cycle.
    const items = buildDeviceList(terminals, cloudMidCycle);
    expect(statusOf(items, DISH_KEY)).toBe("online");
    expect(statusOf(items, MAIN_ROUTER_KEY)).toBe("online");
    expect(statusOf(items, MESH_KEY)).toBe("offline");
  });

  it("greens LAN-reachable devices even when their cloud telemetry is hours stale", () => {
    const lanOnline = lanOnlineDeviceIds({
      dish: {
        deviceInfo: { id: DISH },
        downstreamRouters: { [MAIN_ROUTER]: { role: "CONTROLLER", lastSeen: String(NOW * 1e6) } },
      },
      dishReachable: true,
      router: { deviceInfo: { id: MAIN_ROUTER } },
      routerReachable: true,
      nowMs: NOW,
    });
    const hoursStale: Record<string, DeviceTelemetry> = {
      [DISH]: { kind: "dish", timestampMs: NOW - 6 * 3_600_000 } as DeviceTelemetry,
      [MAIN_ROUTER]: { kind: "router", timestampMs: NOW - 6 * 3_600_000 } as DeviceTelemetry,
      [MESH]: cloudMidCycle[MESH],
    };
    const items = buildDeviceList(terminals, hoursStale, lanOnline);
    expect(statusOf(items, DISH_KEY)).toBe("online");
    expect(statusOf(items, MAIN_ROUTER_KEY)).toBe("online");
    // No local vote for the dead mesh, so the cloud still rules it offline.
    expect(statusOf(items, MESH_KEY)).toBe("offline");
  });

  it("leaves the dots to the cloud when nothing local answers", () => {
    // Viewing the account from another network: no LAN presence at all, and a
    // healthy dish must not turn red just because we cannot reach it from here.
    const items = buildDeviceList(terminals, cloudMidCycle, new Set());
    expect(statusOf(items, DISH_KEY)).toBe("online");
    expect(statusOf(items, MAIN_ROUTER_KEY)).toBe("online");
  });
});
