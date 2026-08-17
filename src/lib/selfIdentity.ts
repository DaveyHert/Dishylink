// Identifies the device *viewing* this dashboard so the network list can flag
// "This device" the way the official app does. The router API has no such flag
// (get_clients returns the same list to everyone — it can't tell who's asking;
// verified against the reflected WifiClient schema), so this is a client-side
// match: resolve our own address(es), then find the matching client entry.
//
// Three backends, feature-detected, each degrading to the next when its runtime
// API isn't present:
//   • Host choice — the roster entry the user named as theirs      (clientId only)
//   • Electron    — a preload bridge exposes os.networkInterfaces()    (ip + mac)
//   • Web         — the historian echoes the caller's IP at /api/whoami (ip only)
// A browser extension has no route to its own LAN address — chrome.system.network
// is packaged-app-only, and WebRTC returns mDNS-masked .local candidates that
// match no client — so it binds the host choice and has nothing else to fall back
// on. Unresolved on any host means no "This device" row and no pause control.

import { apiRequest } from "./apiHost";
import { selfDeviceHost } from "./selfDeviceHost";

export interface SelfIdentity {
  /** Lowercased IPv4/IPv6 address(es) of this device's active interface(s). */
  ips: string[];
  /** Lowercased interface MAC(s). Populated only when the addresses were read
   *  off real interfaces — a whoami echo of a remote caller can't see a MAC. */
  macs: string[];
  /** The roster entry the user named as this device, where the host asks rather
   *  than resolves. A clientId survives reconnects; a router reset ends it. */
  clientId?: number;
  /**
   * Whether `ips` are the interface addresses of the machine running this
   * dashboard's network requests, rather than an echo of some other caller's
   * address.
   *
   * The distinction only matters to callers reasoning about *routing* — which
   * subnet the requests actually originate from (lib/routerDiagnosis). For
   * matching a row in the client list it is irrelevant, because a remote
   * viewer's echoed address is exactly the one the router lists for it.
   *
   * False for a remote viewer: it is the proxy host, not the browser, that
   * opens the socket to the dish and the router, so that browser's address says
   * nothing about where those requests come from.
   */
  describesHost: boolean;
}

const EMPTY: SelfIdentity = { ips: [], macs: [], describesHost: false };

/** IPv4-mapped IPv6 (`::ffff:192.168.1.45`) → the bare v4 the router reports.
 *  Everything is lowercased so matching is case-insensitive for v6. */
function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, "").toLowerCase();
}

/** Loopback never appears in the router's client list, so drop it — a dashboard
 *  opened on the same host as the historian resolves to loopback and simply
 *  matches nothing, rather than mis-flagging a row. */
function isRoutable(ip: string): boolean {
  return ip !== "" && ip !== "127.0.0.1" && ip !== "::1";
}

function clean(ips: (string | undefined)[]): string[] {
  return ips
    .filter((ip): ip is string => !!ip)
    .map(normalizeIp)
    .filter(isRoutable);
}

async function fromHostChoice(): Promise<SelfIdentity | null> {
  const host = selfDeviceHost();
  if (!host) return null;
  try {
    const clientId = await host.read();
    if (clientId === null) return null;
    // Says which client we are, never where our requests come from.
    return { ips: [], macs: [], clientId, describesHost: false };
  } catch {
    return null;
  }
}

interface DishlinkBridge {
  selfIdentity?: () => Promise<{
    ipAddresses?: string[];
    macAddresses?: string[];
    clientId?: number;
  }>;
  rememberSelfDevice?: (clientId: number) => Promise<void>;
}
async function fromElectron(): Promise<SelfIdentity | null> {
  const bridge = (globalThis as { dishlink?: DishlinkBridge }).dishlink;
  if (!bridge?.selfIdentity) return null;
  try {
    const identity = await bridge.selfIdentity();
    return {
      ips: clean(identity.ipAddresses ?? []),
      macs: (identity.macAddresses ?? []).map((macAddress) => macAddress.toLowerCase()),
      clientId: identity.clientId,
      // Read from this process's own os.networkInterfaces(), and the desktop
      // app makes its LAN requests from that same process.
      describesHost: true,
    };
  } catch {
    return null;
  }
}

async function fromWhoami(signal?: AbortSignal): Promise<SelfIdentity | null> {
  try {
    const response = await apiRequest("/api/whoami", { signal });
    if (!response.ok) return null;
    // Remote viewer → { ips: [callerIp] }. Same-host viewer → this host's own
    // interface ips + macs (see the historian's /api/whoami).
    const { ips, macs } = (await response.json()) as { ips?: string[]; macs?: string[] };
    const cleaned = clean(ips ?? []);
    const macList = (macs ?? []).map((mac) => mac.toLowerCase());
    if (cleaned.length === 0 && macList.length === 0) return null;
    // Which of those two branches answered, told apart by the only thing that
    // separates them on the wire: a MAC can be read off an interface but never
    // off a caller's socket, so MACs mean these are the host's own addresses.
    return { ips: cleaned, macs: macList, describesHost: macList.length > 0 };
  } catch {
    return null;
  }
}

/** Resolve the viewer's addresses via the first backend that answers. Never
 *  rejects — an unresolved identity is `EMPTY`, which matches no client. */
export async function resolveSelfIdentity(signal?: AbortSignal): Promise<SelfIdentity> {
  return (await fromHostChoice()) ?? (await fromElectron()) ?? (await fromWhoami(signal)) ?? EMPTY;
}

/** Whether the viewer's own device could be resolved at all. False makes every
 *  `matchesSelf` answer meaningless: nothing matches an unknown identity. */
export function selfIdentified(self: SelfIdentity): boolean {
  return self.clientId !== undefined || self.ips.length > 0 || self.macs.length > 0;
}

/** True when this client entry is the device viewing the dashboard. Either signal
 *  is enough: a clientId identifies this device from anywhere, and the addresses
 *  still identify it on the router's own network, where a clientId kept from
 *  before a router reset would name whichever device inherited the number. */
export function matchesSelf(
  client: { clientId?: number; macAddress?: string; ipAddress?: string; ipv6Addresses?: string[] },
  self: SelfIdentity,
): boolean {
  if (self.clientId !== undefined && client.clientId === self.clientId) return true;
  return matchesSelfByAddress(client, self);
}

/** The address half of `matchesSelf` alone. A caller learning which entry this
 *  device is cannot use the clientId branch to find it, and an address match only
 *  means anything on the network that issued the address. */
export function matchesSelfByAddress(
  client: { macAddress?: string; ipAddress?: string; ipv6Addresses?: string[] },
  self: SelfIdentity,
): boolean {
  const mac = client.macAddress?.toLowerCase();
  if (mac && self.macs.includes(mac)) return true;
  const v4 = client.ipAddress ? normalizeIp(client.ipAddress) : undefined;
  if (v4 && self.ips.includes(v4)) return true;
  return (client.ipv6Addresses ?? []).some((addr) => self.ips.includes(normalizeIp(addr)));
}

/** Hand this device's roster id to the host that writes pauses, where there is
 *  one. Nothing to do on a host that resolves the viewer some other way. */
export function rememberSelfDevice(clientId: number): void {
  const bridge = (globalThis as { dishlink?: DishlinkBridge }).dishlink;
  void bridge?.rememberSelfDevice?.(clientId);
}
