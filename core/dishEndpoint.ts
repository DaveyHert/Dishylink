// Where to reach the Starlink dish.
//
// 192.168.100.1 is fixed in the dish's firmware, so on a standard kit there is
// nothing to configure. It is not reachable, though, when the kit sits behind
// another router: a Starlink Mini wired into a MikroTik (or any third-party
// router) can be reachable at that router's LAN address instead, and the router
// has to be the one forwarding port 9201 to the dish. That setup has no address
// the app can derive, so the user names it (see the settings row).
//
// The port never changes: the dish serves the same grpc-web API there whatever
// address it is reached at.

import { DISH_LAN_ADDRESS, DISH_PORT } from "./dishClient";
import { normalizeIpAddress, originFor } from "./ipAddress";

/** Always tried when nothing is configured, so an ordinary kit behaves exactly
 *  as it did before the setting existed. */
export const DISH_IPV4_ORIGIN = originFor(DISH_LAN_ADDRESS, DISH_PORT);

/**
 * The origin the dish is dialled at, configured address first.
 *
 * Unlike the router there is no second candidate to fall back to: a dish on a
 * moved network is reached at exactly one address, and probing others would aim
 * this app's traffic at boxes that are not the dish.
 */
export function dishOriginFrom(configuredAddress?: string | null): string {
  const configured = configuredAddress ? normalizeIpAddress(configuredAddress) : null;
  return configured ? originFor(configured, DISH_PORT) : DISH_IPV4_ORIGIN;
}

/** The absolute handle URL, for code with no proxy origin to resolve against. */
export function dishHandleUrlFrom(configuredAddress?: string | null): string {
  return `${dishOriginFrom(configuredAddress)}/SpaceX.API.Device.Device/Handle`;
}
