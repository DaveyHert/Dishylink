// Fetches persisted latency-quality summaries from the local historian service
// (/api/latency). A *separate* feed from the in-memory telemetry samples — it
// survives reloads and reaches back days/weeks via the per-minute histogram
// store, but only exists while `npm run historian` has been running.

import { usePersistedHistory, type PersistedHistoryState } from "./usePersistedHistory";
import type { EnergyRange } from "./useEnergyHistory";

export interface LatencyStatMetrics {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  jitter: number | null;
  spread: number | null;
  dropPct: number | null;
}

export interface LatencyBucket {
  t: number;
  expectedSeconds: number;
  sampledSeconds: number;
  p95: number | null;
  p99: number | null;
  jitter: number | null;
  dropPct: number | null;
}

export interface LatencySummary {
  range: EnergyRange;
  coverage: { sampledSeconds: number; expectedSeconds: number; fraction: number };
  score: number;
  grade: string;
  dish: LatencyStatMetrics;
  router: LatencyStatMetrics | null;
  buckets: LatencyBucket[];
}

export type LatencyHistoryState = PersistedHistoryState<LatencySummary>;

export function useLatencyHistory(range: EnergyRange, active: boolean): LatencyHistoryState {
  return usePersistedHistory<LatencySummary>(`/api/latency?range=${range}`, active);
}
