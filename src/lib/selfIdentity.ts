// Identifies the device *viewing* this dashboard so the network list can flag
// "This device" the way the official app does. The router API has no such flag
// (get_clients returns the same list to everyone — it can't tell who's asking;
// verified against the reflected WifiClient schema), so this is a client-side
// match: resolve our own address(es), then find the matching client entry.
//
// Three backends, feature-detected, each degrading to the next when its runtime
// API isn't present:
//   • Electron  — a preload bridge exposes os.networkInterfaces()  (ip + mac)
//   • Extension — chrome.system.network.getNetworkInterfaces()     (ip only)
//   • Web       — the historian echoes the caller's IP at /api/whoami (ip only)
// Only the web path runs today; the other two light up automatically once those
// targets exist, with no change here.

import { apiRequest } from "./apiHost";

export interface SelfIdentity {
  /** Lowercased IPv4/IPv6 address(es) of this device's active interface(s). */
  ips: string[];
  /** Lowercased interface MAC(s). Populated only under Electron (browsers and
   *  the whoami echo can't see a MAC). */
  macs: string[];
}

const EMPTY: SelfIdentity = { ips: [], macs: [] };

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

interface ElectronBridge {
  getSelfIdentity?: () => Promise<{ ips?: string[]; macs?: string[] }>;
}
interface ChromeNetwork {
  system?: {
    network?: {
      getNetworkInterfaces?: (callback: (list: { address: string }[]) => void) => void;
    };
  };
}

async function fromElectron(): Promise<SelfIdentity | null> {
  const bridge = (globalThis as { electronAPI?: ElectronBridge }).electronAPI;
  if (!bridge?.getSelfIdentity) return null;
  try {
    const id = await bridge.getSelfIdentity();
    return { ips: clean(id.ips ?? []), macs: (id.macs ?? []).map((mac) => mac.toLowerCase()) };
  } catch {
    return null;
  }
}

async function fromExtension(): Promise<SelfIdentity | null> {
  const getInterfaces = (globalThis as { chrome?: ChromeNetwork }).chrome?.system?.network
    ?.getNetworkInterfaces;
  if (!getInterfaces) return null;
  try {
    const list = await new Promise<{ address: string }[]>((resolve) => getInterfaces(resolve));
    return { ips: clean(list.map((iface) => iface.address)), macs: [] };
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
    return cleaned.length > 0 || macList.length > 0 ? { ips: cleaned, macs: macList } : null;
  } catch {
    return null;
  }
}

/** Resolve the viewer's addresses via the first backend that answers. Never
 *  rejects — an unresolved identity is `EMPTY`, which matches no client. */
export async function resolveSelfIdentity(signal?: AbortSignal): Promise<SelfIdentity> {
  return (await fromElectron()) ?? (await fromExtension()) ?? (await fromWhoami(signal)) ?? EMPTY;
}

/** True when this client entry is the device viewing the dashboard. MAC wins
 *  when present (Electron); otherwise falls back to v4 then v6 address match —
 *  Starlink hands out IPv6, so a v6-connected viewer must still resolve. */
export function matchesSelf(
  client: { macAddress?: string; ipAddress?: string; ipv6Addresses?: string[] },
  self: SelfIdentity,
): boolean {
  const mac = client.macAddress?.toLowerCase();
  if (mac && self.macs.includes(mac)) return true;
  const v4 = client.ipAddress ? normalizeIp(client.ipAddress) : undefined;
  if (v4 && self.ips.includes(v4)) return true;
  return (client.ipv6Addresses ?? []).some((addr) => self.ips.includes(normalizeIp(addr)));
}
