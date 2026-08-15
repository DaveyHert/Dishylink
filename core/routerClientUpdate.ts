import type {
  DishClient,
  WifiClientConfigJson,
  WifiClientJson,
  WifiNetworkConfigJson,
} from "./dishClient";
import type { HostNetworkIdentity } from "./hostNetworkIdentity";

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

/** True when this router client entry is the machine preparing the request.
 *  Both sides are normalised here so no caller has to pre-lowercase. */
export function clientIsHost(client: WifiClientJson, host: HostNetworkIdentity): boolean {
  const macAddress = client.macAddress?.toLowerCase();
  if (macAddress && host.macAddresses.some((candidate) => candidate.toLowerCase() === macAddress))
    return true;
  const hostAddresses = host.ipAddresses.map(normalizeAddress);
  return [client.ipAddress, ...(client.ipv6Addresses ?? [])].some(
    (address) => address && hostAddresses.includes(normalizeAddress(address)),
  );
}

/** Trusted-host preparation: source target, config, and client identity directly
 *  from the local router immediately before encoding the cloud write.
 *
 *  A device that pauses itself cannot undo it — the official Starlink app hides
 *  the control for the device it runs on, so recovery needs a second machine.
 *  `hostIdentity` refuses that write here because the UI guard is bypassable.
 *  Renaming carries no such risk and is not guarded. */
export async function prepareRouterClientUpdate(
  router: DishClient,
  update: RouterClientUpdate,
  hostIdentity?: HostNetworkIdentity,
): Promise<Uint8Array> {
  const [config, status] = await Promise.all([
    router.getWifiConfig(AbortSignal.timeout(5_000)),
    router.getRouterStatus(AbortSignal.timeout(5_000)),
  ]);
  const targetId = status.deviceInfo?.id;
  if (!targetId) throw new Error("Starlink router identity is unavailable");

  if (update.kind === "rename") {
    // A device with a saved entry needs no roster, which is what lets an offline
    // one be renamed; only an unrecognised id costs the extra read.
    const saved = (config.clientConfigs ?? []).some(
      (client) => client.clientId === update.clientId,
    );
    const liveClient = saved
      ? undefined
      : (await router.getWifiClients(AbortSignal.timeout(5_000))).find(
          (client) => client.clientId === update.clientId,
        );
    return router.encodeRequest(
      buildRouterRenameRequest(targetId, config, update.clientId, update.givenName, liveClient),
    );
  }

  // Pause needs the live roster: it keys on clientId, which only exists while the
  // device is associated, and the host guard matches on the addresses it reports.
  const clients = await router.getWifiClients(AbortSignal.timeout(5_000));
  const liveClient = clients.find((client) => client.clientId === update.clientId);
  if (!liveClient) throw new Error("Device is no longer connected to the router");
  if (update.paused && hostIdentity && clientIsHost(liveClient, hostIdentity))
    throw new Error("Refusing to pause the device Dishylink is running on");
  return router.encodeRequest(
    buildRouterPauseRequest(targetId, config, update.clientId, update.paused, liveClient),
  );
}
