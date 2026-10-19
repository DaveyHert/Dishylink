// What an event's detail says, as one list of sections the card renders and
// the copied text prints line for line, so the two can never disagree.

import type { TFunction } from "i18next";
import {
  knownEventKind,
  outageEventKind,
  outageEventMeta,
  type EventKind,
  type OutageEvent,
} from "@core/telemetry";
import type { OutageReport } from "@core/postmortem";
import {
  formatClockTimeShort,
  formatDateTime,
  formatEventDuration,
  formatThroughputLabel,
} from "../../lib/format";
import { thermalEpisodeLabel } from "../../hooks/useThermalEvents";

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
  /** A line under the rows: the coverage note, or "None" for an empty section. */
  note?: string;
}

const KIND_BY_SEVERITY: Record<OutageEvent["severity"], EventKind> = {
  critical: "outage",
  warning: "degraded",
  advisory: "info",
};

/** The detail's Outage / Degraded / Info tag. A row titled in plain words
 *  (a thermal episode) has no firmware token to look up, so its severity
 *  decides; a row the recorder timed was an outage by definition. */
export function eventDetailKind(event: OutageEvent, report: OutageReport | null): EventKind {
  if (report) return "outage";
  const known = knownEventKind(event.cause);
  if (known) return known;
  if (/^[A-Z0-9_]+$/.test(event.cause)) return outageEventKind(event.cause);
  return KIND_BY_SEVERITY[event.severity];
}

export function eventDetailTitle(event: OutageEvent, t: TFunction): string {
  return outageEventMeta(event.cause, t).label;
}

/** "23 Aug 2026 · 05:53 to 05:54", or just the start when the event ends in
 *  the minute it began: times show no seconds, so "05:53 to 05:53" says nothing. */
export function eventDetailSpan(event: OutageEvent, t: TFunction, locale: string): string {
  const start = formatDateTime(event.startMs, locale);
  const end = formatClockTimeShort(event.startMs + Math.max(event.durationMs, 0), locale);
  if (end === formatClockTimeShort(event.startMs, locale)) return start;
  return t("eventDetail.span", { start, end });
}

export function reportSections(
  report: OutageReport,
  t: TFunction,
  locale: string,
): DetailSection[] {
  const { beforeDrop } = report;
  const notRecorded = t("eventDetail.notRecorded");
  const episodeSpan = (startMs: number, endMs: number | null) =>
    t("eventDetail.span", {
      start: formatClockTimeShort(startMs, locale),
      end: endMs === null ? t("eventDetail.stillRunning") : formatClockTimeShort(endMs, locale),
    });
  return [
    {
      title: t("eventDetail.beforeDrop"),
      rows: [
        {
          label: t("eventDetail.latency"),
          value:
            beforeDrop.latencyAvgMs === null
              ? notRecorded
              : `${Math.round(beforeDrop.latencyAvgMs)} ms`,
        },
        {
          label: t("eventDetail.downlink"),
          value:
            beforeDrop.downlinkAvgBps === null
              ? notRecorded
              : formatThroughputLabel(beforeDrop.downlinkAvgBps),
        },
        {
          label: t("eventDetail.uplink"),
          value:
            beforeDrop.uplinkAvgBps === null
              ? notRecorded
              : formatThroughputLabel(beforeDrop.uplinkAvgBps),
        },
        {
          label: t("eventDetail.packetLoss"),
          value:
            beforeDrop.dropRateAvg === null
              ? notRecorded
              : `${(beforeDrop.dropRateAvg * 100).toFixed(1)}%`,
        },
        {
          label: t("eventDetail.heater"),
          value: beforeDrop.heaterActive ? t("eventDetail.heaterOn") : t("eventDetail.heaterOff"),
        },
      ],
      note: t("eventDetail.coverage", { seconds: beforeDrop.coverageSeconds }),
    },
    {
      title: t("eventDetail.thermal"),
      rows: report.thermal.map((episode) => ({
        label: thermalEpisodeLabel(episode.alertKey, t),
        value: episodeSpan(episode.startMs, episode.endMs),
      })),
      note: report.thermal.length === 0 ? t("eventDetail.thermalNone") : undefined,
    },
  ];
}

/** The detail as plain text, for pasting into a chat, an email or a ticket. */
export function eventDetailText(
  event: OutageEvent,
  report: OutageReport,
  t: TFunction,
  locale: string,
): string {
  const lines = [
    t("eventDetail.textHeader", { label: eventDetailTitle(event, t) }),
    `${eventDetailSpan(event, t, locale)} · ${formatEventDuration(event.durationMs, t)}`,
  ];
  for (const section of reportSections(report, t, locale)) {
    lines.push("", section.title);
    for (const row of section.rows) lines.push(`${row.label}: ${row.value}`);
    if (section.note) lines.push(section.note);
  }
  return lines.join("\n");
}
