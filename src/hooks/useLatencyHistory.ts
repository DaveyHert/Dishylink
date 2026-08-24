// Fetches persisted latency-quality summaries from the local historian service
// (/api/latency). A *separate* feed from the in-memory telemetry samples — it
// survives reloads and reaches back days/weeks via the per-minute histogram
// store, but only exists while `npm run historian` has been running.

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";
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

export interface LatencyHistoryState {
  data: LatencySummary | null;
  loading: boolean;
  /** True when the historian service isn't reachable. */
  unavailable: boolean;
}

const REFRESH_MS = 30_000;

export function useLatencyHistory(range: EnergyRange, active: boolean): LatencyHistoryState {
  const [data, setData] = useState<LatencySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await apiRequest(`/api/latency?range=${range}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const summary = (await response.json()) as LatencySummary;
        if (cancelled) return;
        setData(summary);
        setUnavailable(false);
      } catch {
        if (cancelled) return;
        setUnavailable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [range, active]);

  return { data, loading, unavailable };
}
