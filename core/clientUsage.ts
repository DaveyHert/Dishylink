// One device's monthly data-usage total, as served by the historian's odometer
// (/api/clients `totals`, /api/clients/totals). The historian accumulates the
// router's per-client byte counters across the reconnects that reset them, so
// unlike the router's own figure this survives a roaming or sleeping device.

export interface ClientUsageTotal {
  /** The device this total is keyed by — the router's clientId. Undefined only for
   *  a legacy bucket the historian has not yet matched to a live clientId. */
  clientId?: number;
  macAddress: string;
  name?: string;
  /** Cumulative bytes this billing month, across every reconnect. */
  rxBytes: number;
  txBytes: number;
  /** Start of the month these totals cover (local), epoch ms. */
  sinceMs: number;
  /** Last time the device was seen active, epoch ms. */
  lastSeenMs: number;
}

/** The key a total is stored and looked up under — the clientId (as the historian
 *  keys it), falling back to the MAC for a legacy bucket without one. Mirrors the
 *  server's `keyOf`, so a client row and its total resolve to the same key. */
export function usageKey(clientId: number | undefined, macAddress: string | undefined): string {
  return clientId !== undefined ? String(clientId) : (macAddress ?? "");
}
