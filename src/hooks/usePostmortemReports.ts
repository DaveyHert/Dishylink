// Outage post-mortems from the historian's durable log.
//
// The recorder generates one self-contained summary the moment an outage
// episode closes, and this reads them back. Like useOutageHistory: empty while
// the historian is down, refreshed on the same slow beat — a report appears
// within half a minute of the outage ending.

import { useEffect, useMemo, useState } from "react";
import type { OutageReport } from "@core/postmortem";
import { apiRequest } from "../lib/apiHost";

const REFRESH_MS = 30_000;

export function usePostmortemReports(): OutageReport[] {
  const [reports, setReports] = useState<OutageReport[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const response = await apiRequest("/api/outages/reports", {
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { reports?: OutageReport[] };
        if (!disposed) setReports(body.reports ?? []);
      } catch {
        // historian down: the dish's own events still populate the log
      }
    };
    load();
    const timerId = window.setInterval(load, REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  return useMemo(() => reports, [reports]);
}
