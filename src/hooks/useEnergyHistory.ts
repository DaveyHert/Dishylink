// Fetches persisted long-term energy totals from the local historian service
// (/api/energy, proxied to the historian). This is a *separate* data feed from
// the in-memory telemetry samples — it survives reloads and reaches back days,
// but only exists while `npm run historian` has been running.

import { usePersistedHistory, type PersistedHistoryState } from "./usePersistedHistory";

export type EnergyRange = "1h" | "6h" | "12h" | "today" | "day" | "week" | "month";

export interface EnergyBucket {
  t: number; // epoch seconds at bucket start
  /** null when nothing was recorded for this slot — absence, not zero use. */
  kWh: number | null;
  sampledSeconds: number;
  /** Seconds of this slot the range covers; the newest slot is still filling. */
  expectedSeconds: number;
}

export interface EnergySummary {
  range: EnergyRange;
  totalKWh: number;
  coverage: { sampledSeconds: number; expectedSeconds: number; fraction: number };
  buckets: EnergyBucket[];
}

export type EnergyHistoryState = PersistedHistoryState<EnergySummary>;

export function useEnergyHistory(range: EnergyRange, active: boolean): EnergyHistoryState {
  return usePersistedHistory<EnergySummary>(`/api/energy?range=${range}`, active);
}
