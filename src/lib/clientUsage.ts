// One device's monthly data-usage total, as served by the historian's odometer
// (/api/clients `totals`, /api/clients/totals). The historian accumulates the
// router's per-client byte counters across the reconnects that reset them, so
// unlike the router's own figure this survives a roaming or sleeping device.

export interface ClientUsageTotal {
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
