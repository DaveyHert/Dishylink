// Derives the uptime / SLA summary from the postmortem store.
//
// Polls /api/outages/reports (30-day retention, already served by the historian)
// and runs buildUptimeSummary over the result. Returns null while the first
// fetch is in flight so callers can show a loading state.

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";
import type { OutageReport } from "@core/postmortem";
import { buildUptimeSummary, type UptimeSummary } from "@core/uptimeSummary";

const REFRESH_MS = 60_000; // SLA figures change slowly; once a minute is enough.

function parseReports(body: unknown): OutageReport[] {
  return (body as { reports?: OutageReport[] }).reports ?? [];
}

export function useUptimeSummary(): UptimeSummary | null {
  const [summary, setSummary] = useState<UptimeSummary | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const response = await apiRequest("/api/outages/reports", {
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok || disposed) return;
        const body: unknown = await response.json();
        if (!disposed) setSummary(buildUptimeSummary(parseReports(body)));
      } catch {
        // Historian not reachable — leave previous value in place.
      }
    };

    void load();
    const timerId = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  return summary;
}
