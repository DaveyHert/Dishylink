// Fetches persisted long-term energy totals from the local collector service
// (/api/energy, proxied to the collector). This is a *separate* data feed from
// the in-memory telemetry samples — it survives reloads and reaches back days,
// but only exists while `npm run collector` has been running.

import { useEffect, useState } from "react";

export type EnergyRange = "1h" | "6h" | "12h" | "today" | "day" | "week" | "month";

export interface EnergyBucket {
  t: number; // epoch seconds at bucket start
  kWh: number;
  sampledSeconds: number;
}

export interface EnergySummary {
  range: EnergyRange;
  totalKWh: number;
  coverage: { sampledSeconds: number; expectedSeconds: number; fraction: number };
  buckets: EnergyBucket[];
}

export interface EnergyHistoryState {
  data: EnergySummary | null;
  loading: boolean;
  /** True when the collector service isn't reachable. */
  unavailable: boolean;
}

const REFRESH_MS = 30_000;

export function useEnergyHistory(range: EnergyRange, active: boolean): EnergyHistoryState {
  const [data, setData] = useState<EnergySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/energy?range=${range}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const summary = (await response.json()) as EnergySummary;
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
