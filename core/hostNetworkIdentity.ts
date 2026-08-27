// Node-only: never import this from the browser bundle.

import { networkInterfaces } from "node:os";

export interface HostNetworkIdentity {
  macAddresses: string[];
  ipAddresses: string[];
  /** The router's id for this machine, learned from the roster on the router's
   *  own network. Unlike the addresses, it identifies this host from anywhere. */
  clientId?: number;
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

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Host identity injected from outside this process — used when the Node
 * process's own NICs are not the machine on the Starlink LAN (Docker Desktop
 * on a Mac runs in a VM). `HOST_LAN_IP` / `HOST_MAC` are comma-separated.
 */
export function identityFromEnv(
  env: NodeJS.Dict<string> = process.env,
): HostNetworkIdentity | null {
  const ipAddresses = [
    ...new Set(splitCsv(env.HOST_LAN_IP).map((ip) => ip.replace(/^::ffff:/i, "").toLowerCase())),
  ];
  const macAddresses = [...new Set(splitCsv(env.HOST_MAC).map((mac) => mac.toLowerCase()))];
  if (ipAddresses.length === 0 && macAddresses.length === 0) return null;
  return { ipAddresses, macAddresses };
}

/** Env identity if set, otherwise this process's own interfaces. */
export function resolveHostIdentity(env: NodeJS.Dict<string> = process.env): HostNetworkIdentity {
  return identityFromEnv(env) ?? localNetworkIdentity();
}
