// Router configuration writes that are not about a single client.
//
// The router merges by apply flag, so naming one field changes that field and
// nothing else. Independent fields — nameservers among them — are therefore sent
// on their own, with no read beforehand. A subnet change is the exception: it
// travels inside the `networks` block, which carries the SSIDs and passphrases
// too, so the current block has to be read and handed back nearly intact.
//
// Every read and write here rides the cloud gateway rather than the LAN. That is
// what makes these usable on the setups that want them most: a kit in bypass
// mode has no reachable router on the local network at all, and its target comes
// from the account.

import type { WifiNetworkConfigJson } from "./dishClient";
import { normalizeIpAddress } from "./ipAddress";

/** The most the router's own app offers: one primary and three backups. */
export const MAX_NAMESERVERS = 4;

/** The subnets the official app offers, in its order. Nothing else is sent: a
 *  value the firmware half-applies leaves the network unreachable from the
 *  machine that asked for it, and there is no safe way to probe for the limit. */
export const SUBNET_PRESETS = [
  "192.168.1.1/24",
  "192.168.2.1/24",
  "192.168.3.1/24",
  "192.168.4.1/24",
  "10.0.0.1/16",
  "10.1.0.1/16",
  "10.2.0.1/16",
  "10.3.0.1/16",
] as const;

export type SubnetPreset = (typeof SUBNET_PRESETS)[number];

/** WPA2-PSK's own bounds. Rejecting here is kinder than letting the router take
 *  a passphrase no device can then use to reconnect. */
const MIN_PASSPHRASE = 8;
const MAX_PASSPHRASE = 63;

/** The router's address once `subnet` applies — the app has to follow it there. */
export function routerAddressForSubnet(subnet: string): string {
  return subnet.split("/")[0];
}

export function isSubnetPreset(value: string): value is SubnetPreset {
  return (SUBNET_PRESETS as readonly string[]).includes(value);
}

/** One `Request` oneof arm, as proto3 JSON renders it: the chosen field present
 *  and the rest absent. */
export interface RouterConfigRequestJson {
  targetId: string;
  wifiSetConfig?: { wifiConfig: Record<string, unknown> };
  factoryReset?: Record<string, never>;
}

/** The writes this builds. Each names one field, so two in flight cannot clobber
 *  each other the way two client-list rewrites would. */
export type RouterConfigUpdate =
  | {
      kind: "customDns";
      /** Empty turns custom DNS off, putting the router back on Starlink's resolvers. */
      nameservers: string[];
    }
  | {
      kind: "subnet";
      subnet: string;
      /** The real passphrase, which the caller must collect from the user. The
       *  router reports the stored one as `•••••` and takes that string
       *  literally if it is written back, locking every device off the WiFi. */
      password: string;
    }
  | {
      /** Not a config field but the same shape of request: one targeted mutation
       *  over the gateway, whose reply its own effect destroys. Carried here so
       *  it inherits that handling rather than growing a parallel path. */
      kind: "factoryReset";
    }
  | {
      kind: "bypass";
      /** On hands the LAN to a third-party router and takes the Starlink
       *  router's own WiFi down with it, so the machine asking for this is
       *  usually the one that loses its connection. Off is the way back. */
      enabled: boolean;
    };

/** The addresses as they will be sent, or null when any of them is not an address
 *  the router could forward to. Order is kept: the first is the primary. */
export function normalizeNameservers(nameservers: readonly string[]): string[] | null {
  if (nameservers.length > MAX_NAMESERVERS) return null;
  const normalized: string[] = [];
  for (const candidate of nameservers) {
    const address = normalizeIpAddress(candidate);
    if (!address) return null;
    // A duplicate resolver is not an error worth refusing a save over, but it is
    // not worth sending twice either.
    if (!normalized.includes(address)) normalized.push(address);
  }
  return normalized;
}

/** The auth blocks whose `password` is the WiFi passphrase, so every mode the
 *  router already populated comes back up on the real value rather than the mask.
 *  `authRadius` also has a `password`, but it is the credential for an external
 *  authentication server — carried alongside `server` and `server_ca` — and a
 *  WiFi passphrase written there would break that login. */
const PASSPHRASE_AUTH_KEYS = ["authWpa2", "authWpa3", "authWpa2Wpa3"];

type Json = Record<string, unknown>;

/**
 * The `networks` block to send for a subnet change, built from what the router
 * currently reports.
 *
 * `bssid` and `ifaceName` are router-assigned: carrying them back makes the
 * firmware discard the entire message without an error. The passphrase reads
 * back masked, so every auth block holding one must be overwritten with the
 * real value.
 */
export function buildSubnetNetworks(
  networks: readonly Json[],
  subnet: string,
  password: string,
): Json[] {
  return networks.map((network, index) => ({
    ...network,
    // Only the first network carries the LAN address; the others inherit it.
    ...(index === 0 ? { ipv4: subnet } : {}),
    basicServiceSets: ((network.basicServiceSets as Json[] | undefined) ?? []).map((set) => {
      const next: Json = { ...set };
      delete next.bssid;
      delete next.ifaceName;
      for (const key of PASSPHRASE_AUTH_KEYS) {
        const auth = next[key] as Json | undefined;
        if (auth && "password" in auth) next[key] = { ...auth, password };
      }
      return next;
    }),
  }));
}

/** Why a subnet change cannot be sent, or null when it can. */
export function subnetRefusal(subnet: string, password: string): string | null {
  if (!isSubnetPreset(subnet)) return "unsupported subnet";
  if (password.length < MIN_PASSPHRASE || password.length > MAX_PASSPHRASE)
    return `Password must contain ${MIN_PASSPHRASE} to ${MAX_PASSPHRASE} characters`;
  return null;
}

/** The bit of DishClient this needs, named structurally so any codec can serve
 *  it rather than the client alone. */
interface RouterCodec {
  encodeRequest(requestJson: object): Uint8Array;
  decodeResponse(responseBytes: Uint8Array): {
    wifiGetConfig?: { wifiConfig?: { networks?: unknown[] } };
  };
}

/**
 * The router's whole WiFi configuration, over the caller's gateway.
 *
 * The same block the LAN serves — SSIDs, mesh nodes, saved device names — for a
 * router the local network cannot reach. Null when the reply carries none.
 */
export async function readRouterWifiConfig(
  codec: RouterCodec,
  targetId: string,
  callGateway: (requestBytes: Uint8Array) => Promise<Uint8Array>,
): Promise<WifiNetworkConfigJson | null> {
  const reply = codec.decodeResponse(
    await callGateway(codec.encodeRequest({ targetId, wifiGetConfig: {} })),
  );
  // The codec is described loosely on purpose — only the write path here reads
  // into the reply — so the shape is named once, at this boundary.
  return (reply.wifiGetConfig?.wifiConfig as WifiNetworkConfigJson | undefined) ?? null;
}

/**
 * The networks a write must preserve, fetched through the caller's gateway.
 *
 * Only a subnet change needs them, so every other update skips the round trip
 * and gets the empty list `buildRouterConfigRequest` ignores.
 */
export async function readCurrentNetworks(
  update: RouterConfigUpdate,
  codec: RouterCodec,
  targetId: string,
  callGateway: (requestBytes: Uint8Array) => Promise<Uint8Array>,
): Promise<Json[]> {
  if (update.kind !== "subnet") return [];
  return readRouterNetworks(codec, targetId, callGateway);
}

async function readRouterNetworks(
  codec: RouterCodec,
  targetId: string,
  callGateway: (requestBytes: Uint8Array) => Promise<Uint8Array>,
): Promise<Json[]> {
  const config = await readRouterWifiConfig(codec, targetId, callGateway);
  return (config?.networks as Json[] | undefined) ?? [];
}

/**
 * The subnet the router is on, over the same gateway the writes use.
 *
 * The LAN reports this too and is asked first. This path answers for the case
 * the LAN cannot: a router sitting on a subnet the app is not looking at is
 * exactly the one whose subnet someone needs to read.
 */
export async function readCurrentSubnet(
  codec: RouterCodec,
  targetId: string,
  callGateway: (requestBytes: Uint8Array) => Promise<Uint8Array>,
): Promise<string | null> {
  const [firstNetwork] = await readRouterNetworks(codec, targetId, callGateway);
  const ipv4 = (firstNetwork as { ipv4?: unknown } | undefined)?.ipv4;
  return typeof ipv4 === "string" ? ipv4 : null;
}

export function buildRouterConfigRequest(
  targetId: string,
  update: RouterConfigUpdate,
  /** Current networks, required for a subnet change and unused otherwise. */
  networks: readonly Json[] = [],
): RouterConfigRequestJson {
  if (!targetId.startsWith("Router-")) throw new Error("invalid router target id");
  if (update.kind === "subnet") {
    const refusal = subnetRefusal(update.subnet, update.password);
    if (refusal) throw new Error(refusal);
    if (networks.length === 0) throw new Error("router reported no networks to change");
    return {
      targetId,
      wifiSetConfig: {
        wifiConfig: {
          networks: buildSubnetNetworks(networks, update.subnet, update.password),
          applyNetworks: true,
        },
      },
    };
  }
  if (update.kind === "bypass") {
    return {
      targetId,
      wifiSetConfig: { wifiConfig: { bypassMode: update.enabled, applyBypassMode: true } },
    };
  }
  // FactoryResetRequest carries no fields.
  if (update.kind === "factoryReset") return { targetId, factoryReset: {} };
  const nameservers = normalizeNameservers(update.nameservers);
  if (!nameservers) throw new Error("invalid DNS server address");
  return {
    targetId,
    wifiSetConfig: { wifiConfig: { nameservers, applyNameservers: true } },
  };
}
