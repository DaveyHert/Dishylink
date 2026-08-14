import type { DishClient, WifiClientConfigJson, WifiNetworkConfigJson } from "./dishClient";

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

/** Trusted-host preparation: source target, config, and client identity directly
 *  from the local router immediately before encoding the cloud write. */
export async function prepareRouterPauseRequest(
  router: DishClient,
  clientId: number,
  paused: boolean,
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
  return router.encodeRequest(
    buildRouterPauseRequest(targetId, config, clientId, paused, liveClient),
  );
}
