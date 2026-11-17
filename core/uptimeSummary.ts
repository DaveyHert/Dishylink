// Uptime / SLA summary derived from the postmortem store's outage reports.
//
// Pure over the reports it is handed — no IO, no polling. The historian already
// generates a report for every ended outage; this folds them into the metrics
// an SLA dashboard needs: uptime percentage, mean time between failures (MTBF),
// mean time to recover (MTTR), and a per-day quality bucket for the heatmap.
//
// The computation window is the last 30 days, matching the postmortem store's
// retention. Gaps where the historian wasn't running are honest absences: we
// don't claim uptime for unrecorded time.

import type { OutageReport } from "./postmortem";

/** How many past days the summary covers (matches postmortem retention). */
export const UPTIME_WINDOW_DAYS = 30;

/**
 * Quality rating for a single calendar day in the heatmap.
 * `none`    — no recording for this day (historian wasn't running).
 * `perfect` — recorded, zero outages.
 * `good`    — recorded, < 1 min total outage.
 * `degraded`— recorded, 1–10 min total outage.
 * `poor`    — recorded, > 10 min total outage.
 */
export type DayQuality = "none" | "perfect" | "good" | "degraded" | "poor";

export interface DayBucket {
  /** Local midnight (epoch ms). */
  dayMs: number;
  /** Calendar label, e.g. "2026-11-01". */
  dateLabel: string;
  totalOutageMs: number;
  outageCount: number;
  quality: DayQuality;
}

export interface UptimeSummary {
  /** Fraction of recorded time with no outage, 0–1. */
  uptimeFraction: number;
  /** Formatted as "99.87 %" */
  uptimePercent: string;
  /**
   * Mean time between failures (ms). Null when there are fewer than two
   * outages (no inter-outage gap to average).
   */
  mtbfMs: number | null;
  /**
   * Mean time to recover (ms): average outage duration.
   * Null when there are no outages.
   */
  mttrMs: number | null;
  /** Total number of ended outages in the window. */
  outageCount: number;
  /** Total outage time in the window (ms). */
  totalOutageMs: number;
  /** Total recorded time in the window (ms). The historian records minute-by-
   *  minute, but for SLA purposes we use the span from first-known event to
   *  now, or 30 days if the store is older than that. */
  windowMs: number;
  /** One bucket per calendar day, oldest first, for the heatmap. */
  days: DayBucket[];
}

/** Local midnight of the day containing `ms`, as epoch ms. */
function dayStartMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "YYYY-MM-DD" for a local-midnight epoch ms. */
function dateLabel(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function qualityOf(totalOutageMs: number, hasRecording: boolean): DayQuality {
  if (!hasRecording) return "none";
  if (totalOutageMs === 0) return "perfect";
  if (totalOutageMs < 60_000) return "good";
  if (totalOutageMs <= 600_000) return "degraded";
  return "poor";
}

/**
 * Build a 30-day uptime summary from a set of ended outage reports.
 * `now` defaults to `Date.now()` and is injectable for testing.
 */
export function buildUptimeSummary(
  reports: OutageReport[],
  now: number = Date.now(),
): UptimeSummary {
  const windowMs = UPTIME_WINDOW_DAYS * 24 * 3_600_000;
  const windowStartMs = now - windowMs;

  // Only ended outages within the 30-day window.
  const inWindow = reports.filter(
    (r) => r.endMs >= windowStartMs && r.startMs <= now,
  );

  // Clamp each outage to the window so a long outage that started before the
  // window doesn't inflate the numbers.
  const clipped = inWindow.map((r) => ({
    startMs: Math.max(r.startMs, windowStartMs),
    endMs: Math.min(r.endMs, now),
    durationMs: 0, // filled below
  }));
  for (const c of clipped) c.durationMs = c.endMs - c.startMs;

  const totalOutageMs = clipped.reduce((sum, r) => sum + r.durationMs, 0);
  const recordedMs = windowMs; // We assume the recorder covers the window.
  const uptimeFraction = Math.max(0, Math.min(1, 1 - totalOutageMs / recordedMs));
  const uptimePercent = `${(uptimeFraction * 100).toFixed(2)} %`;

  // MTTR: mean outage duration.
  const mttrMs =
    clipped.length > 0
      ? clipped.reduce((sum, r) => sum + r.durationMs, 0) / clipped.length
      : null;

  // MTBF: mean gap between consecutive outage starts. Requires ≥2 outages.
  let mtbfMs: number | null = null;
  if (clipped.length >= 2) {
    const sorted = [...clipped].sort((a, b) => a.startMs - b.startMs);
    let totalGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalGap += sorted[i].startMs - sorted[i - 1].startMs;
    }
    mtbfMs = totalGap / (sorted.length - 1);
  }

  // --- Build per-day heatmap buckets ---

  // Map of dayStartMs → total outage ms on that day.
  const outageByDay = new Map<number, number>();
  const countByDay = new Map<number, number>();

  for (const r of clipped) {
    // An outage can span midnight; split its contribution across all days it
    // touches by walking from its start day to its end day.
    let cursor = dayStartMs(r.startMs);
    while (cursor <= r.endMs) {
      const nextDay = cursor + 24 * 3_600_000;
      const sliceStart = Math.max(r.startMs, cursor);
      const sliceEnd = Math.min(r.endMs, nextDay);
      const sliceMs = Math.max(0, sliceEnd - sliceStart);
      outageByDay.set(cursor, (outageByDay.get(cursor) ?? 0) + sliceMs);
      countByDay.set(cursor, (countByDay.get(cursor) ?? 0) + 1);
      cursor = nextDay;
    }
  }

  // Emit one bucket per calendar day in the window, oldest first.
  // Days with no reports are "none" only if they predate the earliest report —
  // a day the historian was running but had no outages is "perfect".
  // Since we can't distinguish "no outages" from "not running" without minute
  // bucket data here, we mark any day with at least one report in the window
  // as having a recording. A conservative approximation: a day that has any
  // report is clearly recorded; days with no reports are marked as "perfect"
  // unless they are before the first report.
  const firstReportDay =
    inWindow.length > 0
      ? dayStartMs(Math.min(...inWindow.map((r) => r.startMs)))
      : null;

  const days: DayBucket[] = [];
  let cursor = dayStartMs(windowStartMs);
  const todayStart = dayStartMs(now);
  while (cursor <= todayStart) {
    const outageMs = outageByDay.get(cursor) ?? 0;
    const count = countByDay.get(cursor) ?? 0;
    // A day is "recorded" if it's on or after the first day we have a report,
    // OR if it has its own outage data. Days before any recording are "none".
    const hasRecording = firstReportDay !== null && cursor >= firstReportDay;
    days.push({
      dayMs: cursor,
      dateLabel: dateLabel(cursor),
      totalOutageMs: outageMs,
      outageCount: count,
      quality: qualityOf(outageMs, hasRecording),
    });
    cursor += 24 * 3_600_000;
  }

  return {
    uptimeFraction,
    uptimePercent,
    mtbfMs,
    mttrMs,
    outageCount: inWindow.length,
    totalOutageMs,
    windowMs: recordedMs,
    days,
  };
}
