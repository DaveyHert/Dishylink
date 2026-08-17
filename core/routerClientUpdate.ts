import type { WifiClientConfigJson, WifiClientJson, WifiNetworkConfigJson } from "./dishClient";
import type { HostNetworkIdentity } from "./hostNetworkIdentity";
import { readRouterWifiConfig } from "./routerConfigUpdate";

const PERMANENT_GROUP = "_permanent";
const WEEK_MINUTES = 7 * 24 * 60;

export interface RouterClientRequestJson {
  targetId: string;
  wifiSetConfig: {
    wifiConfig: {
      clientConfigs: WifiClientConfigJson[];
      applyClientConfigs: true;
    };
  };
}

/** The writes the router accepts against one client. Both rewrite the whole
 *  client list, so they share a single request shape and must not overlap. */
export type RouterClientUpdate =
  | { kind: "pause"; clientId: number; paused: boolean }
  | { kind: "rename"; clientId: number; givenName: string };

function requestFor(
  targetId: string,
  clientConfigs: WifiClientConfigJson[],
): RouterClientRequestJson {
  if (!targetId.startsWith("Router-")) throw new Error("invalid router target id");
  return { targetId, wifiSetConfig: { wifiConfig: { clientConfigs, applyClientConfigs: true } } };
}

const normalizeAddress = (address: string): string =>
  address.replace(/^::ffff:/i, "").toLowerCase();

/**
 * Build the smallest client-config update accepted by the router schema.
 * Every existing client entry and non-permanent schedule is preserved; only
 * the selected client's `_permanent` schedule is added or removed.
 */
export function buildRouterPauseRequest(
  targetId: string,
  config: WifiNetworkConfigJson,
  clientId: number,
  paused: boolean,
  liveClient?: { clientId?: number; macAddress?: string },
): RouterClientRequestJson {
  const existing = [...(config.clientConfigs ?? [])];
  if (!existing.some((client) => client.clientId === clientId)) {
    if (liveClient?.clientId !== clientId || !liveClient.macAddress)
      throw new Error("client is absent from router configuration and live clients");
    existing.push({ clientId, macAddress: liveClient.macAddress });
  }

  const clientConfigs = existing.map((client) => {
    if (client.clientId !== clientId) return { ...client };
    const schedules = (client.weeklyBlockSchedules ?? []).filter(
      (schedule) => schedule.groupId !== PERMANENT_GROUP,
    );
    if (paused) {
      schedules.push({
        blockRanges: [{ startMinutes: 0, endMinutes: WEEK_MINUTES }],
        groupId: PERMANENT_GROUP,
      });
    }
    return { ...client, weeklyBlockSchedules: schedules };
  });

  return requestFor(targetId, clientConfigs);
}

/** Keyed by clientId, which is the only unique handle this firmware gives: it
 *  masks the low three octets of every MAC it reports, so several devices behind
 *  one vendor share an address and renaming by MAC would rename all of them.
 *  A saved entry outlives the association, so an offline device can still be
 *  named; an unknown id is refused rather than appended, since a row for a device
 *  the router has never reported is junk no surface can clear. */
export function buildRouterRenameRequest(
  targetId: string,
  config: WifiNetworkConfigJson,
  clientId: number,
  givenName: string,
  liveClient?: { clientId?: number; macAddress?: string },
): RouterClientRequestJson {
  const existing = [...(config.clientConfigs ?? [])];
  if (!existing.some((client) => client.clientId === clientId)) {
    if (liveClient?.clientId !== clientId || !liveClient.macAddress)
      throw new Error("Device is not known to the router");
    existing.push({ clientId, macAddress: liveClient.macAddress });
  }

  return requestFor(
    targetId,
    existing.map((client) =>
      client.clientId === clientId ? { ...client, givenName } : { ...client },
    ),
  );
}

/** The bit of DishClient a gateway read needs, named structurally so this stays
 *  usable with any codec rather than only the client dialling the LAN. */
interface RouterCodec {
  encodeRequest(requestJson: object): Uint8Array;
  decodeResponse(responseBytes: Uint8Array): {
    wifiGetClients?: { clients?: WifiClientJson[] };
    wifiGetConfig?: { wifiConfig?: WifiNetworkConfigJson };
  };
}

/** One encoded request out to the router and its reply back, through whatever
 *  path the caller has. */
type CallGateway = (requestBytes: Uint8Array) => Promise<Uint8Array>;

/**
 * The devices the router currently reports, over the caller's gateway instead of
 * the LAN.
 *
 * The roster is the same one the LAN serves — same clientIds, same masked MACs,
 * same byte counters — so everything joined on it downstream still joins. What
 * differs is reach: this answers for a router the local network cannot see, and
 * from a machine that is not on that network at all.
 */
export async function readRouterClients(
  codec: RouterCodec,
  targetId: string,
  callGateway: CallGateway,
): Promise<WifiClientJson[]> {
  const reply = codec.decodeResponse(
    await callGateway(codec.encodeRequest({ targetId, wifiGetClients: {} })),
  );
  return reply.wifiGetClients?.clients ?? [];
}

/** True when this router client entry is the machine preparing the request.
 *  Both sides are normalised here so no caller has to pre-lowercase. */
export function clientIsHost(client: WifiClientJson, host: HostNetworkIdentity): boolean {
  // Either signal is enough: a kept id is stale for one roster read after a router
  // reset renumbers every client, and the addresses cover that gap.
  if (host.clientId !== undefined && client.clientId === host.clientId) return true;
  const macAddress = client.macAddress?.toLowerCase();
  if (macAddress && host.macAddresses.some((candidate) => candidate.toLowerCase() === macAddress))
    return true;
  const hostAddresses = host.ipAddresses.map(normalizeAddress);
  return [client.ipAddress, ...(client.ipv6Addresses ?? [])].some(
    (address) => address && hostAddresses.includes(normalizeAddress(address)),
  );
}

/**
 * Trusted-host preparation: read the config and the roster this write has to be
 * built from, then encode it — everything over the caller's gateway.
 *
 * Nothing here touches the LAN. The write cannot go that way — current firmware
 * answers a LAN write with grpc status 7 — and sourcing its inputs there would
 * confine pausing and renaming to a machine sitting on the router's own network,
 * which a kit in bypass does not have.
 *
 * A device that pauses itself cannot undo it: the official Starlink app hides the
 * control for the device it runs on, so recovery needs a second machine.
 * `hostIdentity` refuses that write here because the UI guard is bypassable. A
 * `clientId` in it settles the question from anywhere. Without one the match is by
 * address alone, since this firmware masks the low octets of every MAC it reports,
 * and an address speaks only for a host on the network that issued it. A host that
 * supplies neither leaves a remote self-pause unguarded. Renaming carries no such
 * risk and is not guarded.
 */
export async function prepareRouterClientUpdate(
  codec: RouterCodec,
  update: RouterClientUpdate,
  targetId: string,
  callGateway: CallGateway,
  hostIdentity?: HostNetworkIdentity,
): Promise<Uint8Array> {
  const config = await readRouterWifiConfig(codec, targetId, callGateway);
  if (!config) throw new Error("Starlink router reported no configuration");

  if (update.kind === "rename") {
    // A device with a saved entry needs no roster, which is what lets an offline
    // one be renamed; only an unrecognised id costs the extra read.
    const saved = (config.clientConfigs ?? []).some(
      (client) => client.clientId === update.clientId,
    );
    const liveClient = saved
      ? undefined
      : (await readRouterClients(codec, targetId, callGateway)).find(
          (client) => client.clientId === update.clientId,
        );
    return codec.encodeRequest(
      buildRouterRenameRequest(targetId, config, update.clientId, update.givenName, liveClient),
    );
  }

  // Pause needs the live roster: it keys on clientId, which only exists while the
  // device is associated, and the host guard matches on the addresses it reports.
  const clients = await readRouterClients(codec, targetId, callGateway);
  const liveClient = clients.find((client) => client.clientId === update.clientId);
  if (!liveClient) throw new Error("Device is no longer connected to the router");
  if (update.paused && hostIdentity && clientIsHost(liveClient, hostIdentity))
    throw new Error("Refusing to pause the device Dishylink is running on");
  return codec.encodeRequest(
    buildRouterPauseRequest(targetId, config, update.clientId, update.paused, liveClient),
  );
}
