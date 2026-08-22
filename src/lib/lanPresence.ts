// Which account devices this machine can see on the Starlink LAN right now.
//
// The account panel's dots are otherwise inferred from cloud telemetry, and the
// cloud carries no online/offline field — only a timestamped report uploaded on
// the device's own ~2-minute schedule. Anything on this LAN can be asked
// directly instead, on the polls the app already runs, so its dot reflects the
// last few seconds rather than the last few minutes.
//
// Ids here are the full cloud DeviceId ("ut<uuid>" / "Router-<hex>"). No
// translation is needed: each device's LAN `deviceInfo.id` is byte-identical to
// the id the cloud files it under (verified against both on 2026-07-29).
//
// Presence is a one-way signal. Answering proves a device is up, but silence
// proves nothing — a dish that is down and a dish we are merely away from are
// indistinguishable from here — so absence from this set means "no local
// opinion", never "offline", and the caller falls back to cloud freshness.

import type { DishStatusJson, WifiStatusJson } from "@core/dishClient";
import { freshDownstreamRouterIds } from "@core/routerPresence";

export interface LanPresenceInput {
  /** The dish's own get_status reply, and whether that poll is currently succeeding. */
  dish: DishStatusJson | null;
  dishReachable: boolean;
  /** The router's get_status reply from the app's one shared 5s poll. */
  router: WifiStatusJson | null;
  routerReachable: boolean;
  nowMs?: number;
}

/**
 * Whether the kit has a Starlink router on it that is up right now, according to
 * the dish rather than to whether we can reach it.
 *
 * The distinction is the whole point: a router the dish can see but the app
 * cannot ask is a routing problem between here and there, while no router at all
 * is a kit in bypass mode with nothing to show. A dish that isn't answering has
 * no opinion either way, so it reports none.
 */
export function dishSeesRouter(
  dish: DishStatusJson | null,
  dishReachable: boolean,
  nowMs: number = Date.now(),
): boolean {
  return dishReachable && freshDownstreamRouterIds(dish, nowMs).length > 0;
}

/**
 * The set of cloud DeviceIds currently answering on this LAN.
 *
 * Both feeds keep their last reply through a failure so other surfaces can
 * caveat rather than blank, which is why each is gated on its own reachable
 * flag instead of merely on having a payload — a remembered reply from before
 * the network dropped must not read as presence.
 */
export function lanOnlineDeviceIds(input: LanPresenceInput): Set<string> {
  const { dish, dishReachable, router, routerReachable, nowMs = Date.now() } = input;
  const present = new Set<string>();

  if (dishReachable) {
    const dishId = dish?.deviceInfo?.id;
    if (dishId) present.add(dishId);

    // The dish's view of its routers, which is the only live signal available
    // for a mesh node — it has no LAN address of its own to ask.
    for (const routerId of freshDownstreamRouterIds(dish, nowMs)) present.add(routerId);
  }

  if (routerReachable) {
    const routerId = router?.deviceInfo?.id;
    if (routerId) present.add(routerId);
  }

  return present;
}
