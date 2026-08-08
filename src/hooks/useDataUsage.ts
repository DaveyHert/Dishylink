// Self-measured data usage from the historian's /api/usage (same per-minute
// buckets as energy, integrating the dish's throughput telemetry).
// Kept separate from useEnergyHistory so the two panels stay independent.

import { useEffect, useState } from "react";
import type { EnergyRange } from "./useEnergyHistory";
import { apiRequest } from "../lib/apiHost";

export interface UsageBucket {
  t: number;
  /** null when nothing was recorded for this slot — absence, not zero traffic. */
  downGB: number | null;
  upGB: number | null;
  sampledSeconds: number;
}

export interface UsageSummary {
  range: EnergyRange;
  totalDownGB: number;
  totalUpGB: number;
  coverage: { sampledSeconds: number; expectedSeconds: number; fraction: number };
  buckets: UsageBucket[];
}

const REFRESH_MS = 30_000;

export function useDataUsage(range: EnergyRange, active: boolean) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await apiRequest(`/api/usage?range=${range}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const summary = (await response.json()) as UsageSummary;
        if (cancelled) return;
        setData(summary);
        setUnavailable(false);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };

    void load();
    const timerId = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [range, active]);

  return { data, unavailable };
}
