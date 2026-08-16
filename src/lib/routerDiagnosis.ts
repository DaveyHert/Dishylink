// Why the Starlink router isn't answering, in words the user can act on.
//
// The router answers on one address, 192.168.1.1 unless its subnet was moved in
// the official app, and that address is also the factory
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
// hand tell it apart, neither of them a new request to the router, which is a
// small embedded box that has tripped its watchdog under added load:
//
//   • the dish's get_status lists the routers downstream of it, so the dish
//     itself says whether this kit has a router that is up;
//   • the viewer's own LAN address says whether the router's address is local to
//     this machine or somewhere it would have to route to.
//
// Router up + we are inside its subnet  → something else here holds the address.
// Router up + we are outside it         → we are simply not on its network.
// No router                             → bypass mode, or the router is off.
//
// That table reads the address as a fact about the kit, which holds only for the
// factory default. An address the user set is a claim about where the router is,
// and silence at one is likeliest to mean the claim is wrong — so it is diagnosed
// as itself rather than run through the rows above, which would accuse a
// neighbouring device of holding an address the router was never on.

import { ROUTER_LAN_ADDRESS } from "@core/dishClient";

export type RouterUnreachableCause =
  /** Too early to say. An outage that heals on its own must not be described as
   *  wiring for the user to go and fix. */
  | "checking"
  /** Another device on the viewer's own subnet is using the router's address. */
  | "addressTaken"
  /** The address in the setting answers nothing, and the dish says a router is
   *  up — so it is the setting that is wrong, not the network. */
  | "configuredAddressSilent"
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
  /** Whether the address being dialled came from the setting rather than the
   *  factory default. A default that answers nothing is a fact about the
   *  network; a chosen one is a fact about the choice. */
  addressConfigured: boolean;
  /** Whether the outage has lasted long enough to be worth explaining. Before
   *  that no cause is named, because most silences are a reboot. */
  silencePersisted: boolean;
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
function inRouterSubnet(ip: string, routerAddress: string): boolean {
  const routerPrefix = routerAddress.split(".").slice(0, 3).join(".");
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
export function viewerOnRouterSubnet(
  selfIps: readonly string[] = [],
  routerAddress: string = ROUTER_LAN_ADDRESS,
): boolean | null {
  // A configured IPv6 router address describes no /24 to compare against, so the
  // subnet question has no answer rather than a wrong one.
  if (!isIpv4(routerAddress)) return null;
  const v4 = selfIps.filter(isIpv4);
  if (v4.length === 0) return null;
  return v4.some((ip) => inRouterSubnet(ip, routerAddress));
}

/** Offered as the address to move the *other* router to, so it never names the
 *  one the Starlink router already answers on. */
function suggestedAlternative(routerAddress: string): string {
  return (
    ["192.168.2.1", "192.168.1.1", "192.168.10.1"].find(
      (candidate) => candidate !== routerAddress,
    ) ?? "192.168.10.1"
  );
}

function messagesFor(routerAddress: string): Record<RouterUnreachableCause, string> {
  return {
    addressTaken:
      `Another device on this network is using ${routerAddress}, the address the Starlink ` +
      `router answers on, so the router is hidden behind it. To fix it, connect to your ` +
      `Starlink WiFi, give the other router a different address (like ` +
      `${suggestedAlternative(routerAddress)}), or set the router address below to wherever ` +
      `your Starlink router actually is.`,
    configuredAddressSilent:
      `Nothing answered at ${routerAddress}, the address set below, but the dish reports your ` +
      `Starlink router is running. It is most likely at a different address. Check the one set ` +
      `below, or clear it to go back to the default.`,
    differentNetwork:
      `Your Starlink router is running, but this device isn't on the network ${routerAddress} ` +
      `belongs to. Connect to your Starlink WiFi, or if the router's subnet was changed, set the ` +
      `router address below to where it is now.`,
    noRouter:
      `The dish isn't reporting a Starlink router — it's in bypass mode, or the router is off. ` +
      `WiFi and connected devices come from the router, so there's nothing to show here. ` +
      `Everything on the dish is unaffected.`,
    unknown:
      `Couldn't reach the Starlink router at ${routerAddress}. Another device may be using ` +
      `that address, the router may be in bypass mode or on a different network, or it may be ` +
      `at an address other than the one set below.`,
    checking:
      `Couldn't reach the Starlink router at ${routerAddress}. Working out why; most short ` +
      `silences are the router restarting.`,
  };
}

/** Name the most likely reason the router is silent, erring towards `unknown`
 *  rather than towards a confident answer the signals do not support. */
export function diagnoseRouterUnreachable(
  signals: RouterUnreachableSignals,
  routerAddress: string = ROUTER_LAN_ADDRESS,
): RouterUnreachable {
  const { routerPresent, onRouterSubnet, addressConfigured, silencePersisted } = signals;
  let cause: RouterUnreachableCause = "unknown";
  if (!silencePersisted) {
    cause = "checking";
  } else if (routerPresent === false) {
    cause = "noRouter";
  } else if (routerPresent === true && addressConfigured) {
    cause = "configuredAddressSilent";
  } else if (routerPresent === true && onRouterSubnet !== null) {
    // A router that is up but unreachable is a question of where we are asking
    // from, and that is the one thing our own address settles.
    cause = onRouterSubnet ? "addressTaken" : "differentNetwork";
  }
  return { cause, message: messagesFor(routerAddress)[cause] };
}
