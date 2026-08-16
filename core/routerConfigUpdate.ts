// Router configuration writes that are not about a single client.
//
// Unlike core/routerClientUpdate, nothing here reads the router first. A client
// update has to, because it rewrites the whole client list and must preserve the
// entries it isn't touching. These fields are independent: the router merges by
// apply flag, so naming one field changes that field and nothing else.
//
// That difference is what makes these usable on the setups that want them most.
// A kit in bypass mode has no reachable router at all, so a write that begins
// with a LAN read could never serve it. The target comes from the account
// instead, and the whole exchange rides the cloud gateway.

import { normalizeIpAddress } from "./ipAddress";

/** The most the router's own app offers: one primary and three backups. */
export const MAX_NAMESERVERS = 4;

export interface RouterConfigRequestJson {
  targetId: string;
  wifiSetConfig: { wifiConfig: Record<string, unknown> };
}

/** The writes this builds. Each names one field, so two in flight cannot clobber
 *  each other the way two client-list rewrites would. */
export type RouterConfigUpdate = {
  kind: "customDns";
  /** Empty turns custom DNS off, putting the router back on Starlink's resolvers. */
  nameservers: string[];
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

export function buildRouterConfigRequest(
  targetId: string,
  update: RouterConfigUpdate,
): RouterConfigRequestJson {
  if (!targetId.startsWith("Router-")) throw new Error("invalid router target id");
  const nameservers = normalizeNameservers(update.nameservers);
  if (!nameservers) throw new Error("invalid DNS server address");
  return {
    targetId,
    wifiSetConfig: { wifiConfig: { nameservers, applyNameservers: true } },
  };
}
