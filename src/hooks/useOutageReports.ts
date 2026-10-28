// Outage reports from the recorder's durable log: one per link outage the
// recorder timed, written the moment it ended. Thirty days deep, so a report
// outlives the 48 h events window it was generated beside.

import type { OutageReport } from "@core/postmortem";
import { usePolledEndpoint } from "./usePolledEndpoint";

const NO_REPORTS: OutageReport[] = [];

function pickReports(body: unknown): OutageReport[] {
  return (body as { reports?: OutageReport[] }).reports ?? NO_REPORTS;
}

export function useOutageReports(): OutageReport[] {
  return usePolledEndpoint("/api/outages/reports", pickReports, NO_REPORTS);
}
