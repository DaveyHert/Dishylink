// The outage post-mortem as plain text, for pasting into chat, email, a ticket…
// Shared label maps live here too so the card and the copy can never disagree
// about what a figure is called.

import { outageEventMeta } from "@core/telemetry";
import type { OutageReport } from "@core/postmortem";
import {
  formatClockTimeShort,
  formatDateTime,
  formatEventDuration,
  formatThroughputLabel,
} from "./format";

// Two-state because the report is: the dish never asserts "off" (proto3 JSON
// omits a false snowMeltActive), so only "Active" or "Unknown" can ever occur.
export const SNOW_MELT_LABEL: Record<OutageReport["beforeDrop"]["snowMelt"], string> = {
  active: "Active",
  unknown: "Unknown",
};

export const THERMAL_LABEL: Record<string, string> = {
  thermalThrottle: "Thermal throttling",
  thermalShutdown: "Thermal shutdown",
  powerSupplyThermalThrottle: "Power supply throttling",
};

/** The episode name behind a report the dish's event log blames for nothing — a
 *  dish-unreachable outage has no dish events at all (the dish wasn't
 *  answering), so "Link outage" would misname it. */
export const SOURCE_LABEL: Record<OutageReport["source"], string> = {
  starlinkOutage: "Link outage",
  dishUnreachable: "Dish unreachable",
};

export function causeLabel(report: OutageReport): string {
  return report.cause ? outageEventMeta(report.cause).label : SOURCE_LABEL[report.source];
}

/** The card as text: header, the five minutes before the drop, thermal state. */
export function outageReportText(report: OutageReport): string {
  const { beforeDrop } = report;
  const lines = [
    `Dishylink outage report — ${causeLabel(report)}`,
    `${formatDateTime(report.startMs)} → ${formatClockTimeShort(report.endMs)} · ${formatEventDuration(report.durationMs)}`,
    "",
    "5 minutes before the drop",
    `Latency: ${beforeDrop.latencyAvgMs === null ? "not recorded" : `${Math.round(beforeDrop.latencyAvgMs)} ms`}`,
    `Downlink: ${beforeDrop.downlinkAvgBps === null ? "not recorded" : formatThroughputLabel(beforeDrop.downlinkAvgBps)}`,
    `Uplink: ${beforeDrop.uplinkAvgBps === null ? "not recorded" : formatThroughputLabel(beforeDrop.uplinkAvgBps)}`,
    ...(beforeDrop.dropRateAvg === null
      ? []
      : [`Packet loss: ${(beforeDrop.dropRateAvg * 100).toFixed(1)}%`]),
    `Snow melt: ${SNOW_MELT_LABEL[beforeDrop.snowMelt]}`,
    `Recording: ${beforeDrop.coverageSeconds} s of the window`,
    "",
    "Thermal",
    ...(report.thermal.length === 0
      ? ["None"]
      : report.thermal.map(
          (episode) =>
            `${THERMAL_LABEL[episode.alertKey] ?? episode.alertKey}: ${formatClockTimeShort(episode.startMs)} → ${episode.endMs === null ? "still running" : formatClockTimeShort(episode.endMs)}`,
        )),
  ];
  return lines.join("\n");
}
