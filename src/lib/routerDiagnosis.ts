// Why the Starlink router isn't answering, in words the user can act on.
//
// The router answers only on 192.168.1.1, and that address is also the factory
// default of most consumer routers. Plug a kit in behind one of those — a
// TP-Link, a mesh base, an ISP box — and that router owns 192.168.1.1 on the
// viewer's own wire, leaving the Starlink router one hop upstream wearing the
// same number. Nothing the app does can reach it: a host delivers a packet
// addressed to its own subnet locally and never routes it onward. Measured on a
// double-NAT kit on 2026-08-04, where the dish stayed reachable at 192.168.100.1
// throughout while 192.168.1.1:9001 answered nothing.
//
// That case matters because it is indistinguishable from a dead router in the
// panel, yet the fix is entirely in the user's hands. Two signals already on
// hand tell it apart, neither of them a new request to the router — see
// CLAUDE.md on why the router gets no polls it isn't already being given:
//
//   • the dish's get_status lists the routers downstream of it, so the dish
//     itself says whether this kit has a router that is up;
//   • the viewer's own LAN address says whether 192.168.1.1 is local to this
//     machine or somewhere it would have to route to.
//
// Router up + we are inside its subnet  → something else here holds the address.
// Router up + we are outside it         → we are simply not on its network.
// No router                             → bypass mode, or the router is off.

import { ROUTER_LAN_ADDRESS } from "@core/dishClient";

export type RouterUnreachableCause =
  /** Another device on the viewer's own subnet is using the router's address. */
  | "addressTaken"
  /** The router is up, but this device is not on its network. */
  | "differentNetwork"
  /** The kit has no router: bypass mode, or the router is powered off. */
  | "noRouter"
  /** Not enough signal to choose between the above. */
  | "unknown";

export interface RouterUnreachable {
  cause: RouterUnreachableCause;
  /** The whole thing the user reads. Written as two short sentences: what is
   *  wrong, then what to do — the panels render it as one block of text. */
  message: string;
}

export interface RouterUnreachableSignals {
  /** Whether the dish reports a router downstream of it (lib/lanPresence's
   *  `dishSeesRouter`). `null` when the dish is not answering either, which is
   *  no evidence in either direction. */
  routerPresent: boolean | null;
  /** Whether the viewer's own address sits in the router's subnet. `null` when
   *  the host cannot resolve its own IPv4 — under the extension, and on an
   *  IPv6-only viewer — which costs precision, not correctness. */
  onRouterSubnet: boolean | null;
}

/** Dotted-quad only. Anything else — IPv6, including the `::ffff:` and embedded
 *  forms that still contain dots — is not an address this can place. */
function isIpv4(ip: string): boolean {
  const octets = ip.split(".");
  return (
    octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/** The router's LAN is a /24 (192.168.1.0/24, read off a kit's own DHCP lease),
 *  so a machine shares its wire exactly when the first three octets match. */
function inRouterSubnet(ip: string): boolean {
  const routerPrefix = ROUTER_LAN_ADDRESS.split(".").slice(0, 3).join(".");
  return ip.split(".").slice(0, 3).join(".") === routerPrefix;
}

/**
 * Where the machine making the router request sits relative to the router's
 * subnet, or `null` when its addresses say nothing.
 *
 * `null` is a real answer, distinct from "somewhere else": no IPv4 to reason
 * about — the extension resolves nothing, an IPv6-only viewer has no dotted
 * quad, and a remote viewer's address is withheld by the caller — and a
 * diagnosis built on a guess there would be confidently wrong.
 */
export function viewerOnRouterSubnet(selfIps: readonly string[] = []): boolean | null {
  const v4 = selfIps.filter(isIpv4);
  if (v4.length === 0) return null;
  return v4.some(inRouterSubnet);
}

const MESSAGES: Record<RouterUnreachableCause, string> = {
  addressTaken:
    `Another device on this network is using ${ROUTER_LAN_ADDRESS}, the address the Starlink ` +
    `router answers on, so the router is hidden behind it. Connect to your Starlink WiFi, or ` +
    `change the other router's address (192.168.2.1, say), and this fills in.`,
  differentNetwork:
    `Your Starlink router is running, but this device isn't on its network. Connect to your ` +
    `Starlink WiFi to see its settings and the devices using it.`,
  noRouter:
    `The dish isn't reporting a Starlink router — it's in bypass mode, or the router is off. ` +
    `WiFi and connected devices come from the router, so there's nothing to show here. ` +
    `Everything on the dish is unaffected.`,
  unknown:
    `Couldn't reach the Starlink router at ${ROUTER_LAN_ADDRESS}. Another device may be using ` +
    `that address, or the router may be in bypass mode or on a different network.`,
};

/** Name the most likely reason the router is silent, erring towards `unknown`
 *  rather than towards a confident answer the signals do not support. */
export function diagnoseRouterUnreachable(signals: RouterUnreachableSignals): RouterUnreachable {
  const { routerPresent, onRouterSubnet } = signals;
  let cause: RouterUnreachableCause = "unknown";
  if (routerPresent === false) {
    cause = "noRouter";
  } else if (routerPresent === true && onRouterSubnet !== null) {
    // A router that is up but unreachable is a question of where we are asking
    // from, and that is the one thing our own address settles.
    cause = onRouterSubnet ? "addressTaken" : "differentNetwork";
  }
  return { cause, message: MESSAGES[cause] };
}
