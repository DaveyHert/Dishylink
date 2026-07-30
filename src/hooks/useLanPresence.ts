// Keeps the account panel's view of "which devices are answering on this LAN"
// current, off polls that are already running: the caller's dish get_status and
// the app's one shared router feed. Nothing here asks the dish or the router for
// anything of its own.

import { useEffect, useMemo, useState } from "react";
import type { DishStatusJson, WifiStatusJson } from "@core/dishClient";
import { subscribeRouterStatus } from "../lib/routerStatusFeed";
import { lanOnlineDeviceIds } from "../lib/lanPresence";

/** Cloud DeviceIds currently reachable on the LAN. Empty away from the Starlink
 *  network, which leaves every dot to cloud freshness — the correct fallback,
 *  since local silence is not evidence a device is down. */
export function useLanPresence(
  dish: DishStatusJson | null,
  dishConnectionState: string,
): ReadonlySet<string> {
  const [router, setRouter] = useState<{ status: WifiStatusJson | null; reachable: boolean }>({
    status: null,
    reachable: false,
  });

  useEffect(
    () =>
      subscribeRouterStatus(({ status, reachable }) =>
        // `reachable` is null while the first poll is still in flight; only a
        // true reading is presence.
        setRouter({ status, reachable: reachable === true }),
      ),
    [],
  );

  // Memoised so the set keeps one identity between polls; rebuilding it on
  // every render would re-run the device list's own memo each pass.
  return useMemo(
    () =>
      lanOnlineDeviceIds({
        dish,
        dishReachable: dishConnectionState === "online",
        router: router.status,
        routerReachable: router.reachable,
      }),
    [dish, dishConnectionState, router],
  );
}
