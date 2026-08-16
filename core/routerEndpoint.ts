// Where to reach the Starlink router, when its IPv4 address is not available.
//
// The router answers on 192.168.1.1 — which is also the factory default of most
// consumer routers, so a kit plugged in behind one of those has that address
// taken on the viewer's own wire and the router is unreachable by IPv4 no matter
// what (see lib/routerDiagnosis for the diagnosis of exactly that).
//
// It also answers the same gRPC on IPv6, and there the collision cannot happen:
// addresses are unique, so nothing else is wearing the router's. Measured on
// 2026-08-04 against a Mini — full wifi_get_clients on both its ULA and its
// global address, port 9001:
//
//   fe80::7624:9fff:fe2c:b65e%5   OPEN, but unusable — see the zone note below
//   fdc1:5296:c0f2:10::1          OPEN   (ULA)
//   2605:59c1:19af:3710::1        OPEN   (global)
//
// The address is derivable rather than configured: the router takes ::1 of each
// /64 it hands out, so a host that has an address in that prefix already knows
// where the router is. Nothing is discovered, probed, or asked of the router.
//
// Link-local is deliberately excluded even though it answers. A link-local URL
// needs a zone ("%5"), and WHATWG URL — which every fetch on every host is built
// on — rejects zone ids outright with "Failed to parse URL". It cannot be dialled
// from this codebase at all, so offering it would only produce failures.

import { ROUTER_LAN_ADDRESS } from "./dishClient";
import { expandIpv6, normalizeIpAddress, originFor } from "./ipAddress";

export { expandIpv6 };

export const ROUTER_PORT = 9001;

/** The address the router is reached at whenever nothing has taken it. Always
 *  tried first, so a working setup behaves exactly as it did before any of this
 *  existed: one attempt, one origin, no extra traffic. */
export const ROUTER_IPV4_ORIGIN = `http://${ROUTER_LAN_ADDRESS}:${ROUTER_PORT}`;

/** Whether an address is one the router's prefix can be derived from: a global
 *  or unique-local address on a real network. Link-local is excluded because it
 *  cannot be put in a URL (see the note at the top); loopback and multicast
 *  describe no LAN at all. */
function isDerivable(hextets: string[]): boolean {
  const first = Number.parseInt(hextets[0], 16);
  if (first === 0) return false; // ::1 and the unspecified address
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  const isUniqueLocal = (first & 0xfe00) === 0xfc00; // fc00::/7
  const isGlobal = (first & 0xe000) === 0x2000; // 2000::/3
  return isUniqueLocal || isGlobal;
}

/**
 * The router's address in each /64 this host sits in — the prefix with ::1.
 *
 * Deduplicated and order-stable, so a host with several addresses in one prefix
 * (a stable address plus its temporary privacy addresses, which is the normal
 * case) yields that prefix once rather than three times.
 */
export function routerAddressesFrom(ownIps: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const ip of ownIps) {
    const hextets = expandIpv6(ip);
    if (!hextets || !isDerivable(hextets)) continue;
    // Trailing zeros in the prefix stay written out: "fdc1:5296:c0f2:10::1" is
    // built by joining four hextets, so a prefix ending in 0 keeps its group
    // rather than collapsing into a second "::", which would be malformed.
    seen.add(`${hextets.slice(0, 4).join(":")}::1`);
  }
  return [...seen];
}

/**
 * Every origin worth trying, IPv4 first.
 *
 * The order is the guarantee against regression: on a setup where the router's
 * IPv4 address is its own, the first entry answers and nothing else is ever
 * dialled.
 *
 * A configured address replaces the list rather than joining it. Someone who set
 * one has told us the default is wrong for their network, and on the setups that
 * need this the default is not merely silent — it is another vendor's router,
 * sitting on the address ours would otherwise have. Trying it anyway would aim
 * this app's traffic at a stranger's box.
 */
export function routerOriginsFrom(
  ownIps: readonly string[],
  configuredAddress?: string | null,
): string[] {
  const configured = configuredAddress ? normalizeIpAddress(configuredAddress) : null;
  if (configured) return [originFor(configured, ROUTER_PORT)];
  return [
    ROUTER_IPV4_ORIGIN,
    ...routerAddressesFrom(ownIps).map((address) => `http://[${address}]:${ROUTER_PORT}`),
  ];
}

/**
 * Runs router calls against the first origin that works, and remembers it.
 *
 * Falling back costs a second request, but only ever one that has already
 * failed: a working router is reached on the first attempt and never sees the
 * extra traffic. That matters here — the router is an embedded box that has
 * rebooted under load, and nothing in this codebase may add a poll to it. This
 * adds none; it re-aims a request that found nobody home.
 *
 * The remembered origin is dropped as soon as it fails, so a kit that moves
 * between networks re-derives rather than staying pinned to an address that has
 * stopped meaning anything.
 *
 * `readConfiguredAddress` is read per call for the same reason the addresses are:
 * a setting changed while this process runs has to take effect on the next
 * request, and the historian can run for weeks between restarts.
 */
export function createRouterOrigins(
  listOwnIps: () => readonly string[],
  readConfiguredAddress: () => string | null = () => null,
) {
  let preferred: string | null = null;

  return {
    /** For diagnostics and tests — which origin is currently believed good. */
    get current(): string | null {
      return preferred;
    },
    /**
     * Try `run` against each candidate until one resolves. The last failure is
     * rethrown when none does, so callers see a real error rather than a
     * synthetic one hiding what actually went wrong.
     */
    async run<T>(run: (origin: string) => Promise<T>): Promise<T> {
      const candidates = routerOriginsFrom(listOwnIps(), readConfiguredAddress());
      // The remembered origin goes first; the rest stay in their usual order so
      // a stale preference costs one attempt, not a reshuffled search.
      const ordered =
        preferred && candidates.includes(preferred)
          ? [preferred, ...candidates.filter((origin) => origin !== preferred)]
          : candidates;
      let lastError: unknown;
      for (const origin of ordered) {
        try {
          const result = await run(origin);
          preferred = origin;
          return result;
        } catch (error) {
          lastError = error;
          if (preferred === origin) preferred = null;
        }
      }
      throw lastError;
    },
  };
}
