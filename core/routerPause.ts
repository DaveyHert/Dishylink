import type {
  DishClient,
  WifiClientConfigJson,
  WifiClientJson,
  WifiNetworkConfigJson,
} from "./dishClient";
import type { HostNetworkIdentity } from "./hostNetworkIdentity";

const PERMANENT_GROUP = "_permanent";
const WEEK_MINUTES = 7 * 24 * 60;

export interface RouterPauseRequestJson {
  targetId: string;
  wifiSetConfig: {
    wifiConfig: {
      clientConfigs: WifiClientConfigJson[];
      applyClientConfigs: true;
    };
  };
}

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
): RouterPauseRequestJson {
  if (!targetId.startsWith("Router-")) throw new Error("invalid router target id");
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

  return {
    targetId,
    wifiSetConfig: {
      wifiConfig: {
        clientConfigs,
        applyClientConfigs: true,
      },
    },
  };
}

const normalizeAddress = (address: string): string =>
  address.replace(/^::ffff:/i, "").toLowerCase();

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
 *  `hostIdentity` refuses that write here because the UI guard is bypassable. */
export async function prepareRouterPauseRequest(
  router: DishClient,
  clientId: number,
  paused: boolean,
  hostIdentity?: HostNetworkIdentity,
): Promise<Uint8Array> {
  const [config, status, clients] = await Promise.all([
    router.getWifiConfig(AbortSignal.timeout(5_000)),
    router.getRouterStatus(AbortSignal.timeout(5_000)),
    router.getWifiClients(AbortSignal.timeout(5_000)),
  ]);
  const targetId = status.deviceInfo?.id;
  if (!targetId) throw new Error("Starlink router identity is unavailable");
  const liveClient = clients.find((client) => client.clientId === clientId);
  if (!liveClient) throw new Error("Device is no longer connected to the router");
  if (paused && hostIdentity && clientIsHost(liveClient, hostIdentity))
    throw new Error("Refusing to pause the device Dishylink is running on");
  return router.encodeRequest(
    buildRouterPauseRequest(targetId, config, clientId, paused, liveClient),
  );
}
