// The Nodes tab's roster: the router plus every mesh node it has been paired
// with, whether or not that node is currently up.

import type { WifiClientJson, WifiNetworkConfigJson } from "@core/dishClient";

/** One row of the Nodes tab: the router itself plus every mesh node it has been
 *  paired with, connected or not. */
export interface NodeEntry {
  key: string;
  name: string;
  status: string;
  connected: boolean;
  /** Present only while the node is up — the live client entry to drill into. */
  client?: WifiClientJson;
  /** The clients attached to this node. Carried rather than counted so the
   *  node's "Connected devices" list and its count cannot drift apart. */
  devices: WifiClientJson[];
}

/** Friendly name for a live node. The API only ever sends the raw role
 *  ("CONTROLLER"), so the router's human label is ours, as in the app; a mesh
 *  node prefers the name saved in its config over its bare hostname. */
function nodeName(client: WifiClientJson, wifiConfig: WifiNetworkConfigJson | null): string {
  if (client.role === "CONTROLLER") return "Main Router";
  const configured = client.deviceId
    ? wifiConfig?.meshConfigs?.[client.deviceId]?.displayName
    : undefined;
  return client.givenName || configured || client.name || "Mesh node";
}

/**
 * Builds the Nodes roster by joining two sources: live clients with a non-CLIENT
 * role (the router, plus any mesh node currently up) and `wifiConfig.meshConfigs`
 * (every paired node, keyed by deviceId). A config entry with no live client is a
 * node that is paired but down — invisible to the client list alone.
 */
export function buildNodeRoster(
  clients: WifiClientJson[],
  wifiConfig: WifiNetworkConfigJson | null,
): NodeEntry[] {
  const infrastructure = clients.filter((client) => client.role && client.role !== "CLIENT");
  const liveDeviceIds = new Set(infrastructure.map((client) => client.deviceId).filter(Boolean));

  const nodes: NodeEntry[] = infrastructure.map((client, index) => ({
    key: client.deviceId ?? client.macAddress ?? `node-${index}`,
    name: nodeName(client, wifiConfig),
    status: client.role === "CONTROLLER" ? "Connected to Starlink" : "Connected",
    connected: true,
    client,
    devices: clients.filter(
      (peer) => peer.role === "CLIENT" && peer.upstreamMacAddress === client.macAddress,
    ),
  }));

  for (const [deviceId, meshNode] of Object.entries(wifiConfig?.meshConfigs ?? {})) {
    if (liveDeviceIds.has(deviceId)) continue;
    nodes.push({
      key: deviceId,
      name: meshNode.displayName || "Mesh node",
      status: "Disconnected",
      connected: false,
      // A node that is down reports no clients — they have roamed elsewhere.
      devices: [],
    });
  }

  // Router first, then connected mesh nodes, then the ones that are down.
  return nodes.sort((a, b) => Number(b.connected) - Number(a.connected));
}
