// Node-only: never import this from the browser bundle.

import { networkInterfaces } from "node:os";

export interface HostNetworkIdentity {
  macAddresses: string[];
  ipAddresses: string[];
}

export function localNetworkIdentity(): HostNetworkIdentity {
  const interfaces = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal);
  return {
    macAddresses: [
      ...new Set(
        interfaces
          .map((entry) => entry.mac.toLowerCase())
          .filter((macAddress) => macAddress && macAddress !== "00:00:00:00:00:00"),
      ),
    ],
    ipAddresses: [
      ...new Set(interfaces.map((entry) => entry.address.replace(/^::ffff:/i, "").toLowerCase())),
    ],
  };
}
