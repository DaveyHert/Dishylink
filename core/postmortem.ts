// Outage post-mortem synthesis.
//
// When one of the recorder's own link-outage episodes ends, this folds what was
// already recorded around it into one self-contained report: when it happened
// and for how long, which dish event explains it, what the link was doing in
// the five minutes before the drop, whether the heater was running, and any
// thermal episode touching it. Nothing here asks a device anything: every
// figure comes from recordings the host already holds.
//
// Pure and IO-free so the desktop recorder and the extension's worker produce
// the same report from the same inputs, and the dashboard can match a report
// to the event row that owns it with the same rule in every host.

import {
  canonicalCause,
  outageEventKind,
  type OutageEvent,
  type TelemetrySample,
} from "./telemetry";
import { THERMAL_ALERT_KEYS } from "./alertDefinitions";
import type { MinuteBucket } from "./energyBuckets";

/** How far back before the drop the report looks for "what the link was doing". */
export const BEFORE_WINDOW_MS = 5 * 60_000;

/** The recorder stamps an episode when its poll noticed the outage and the dish
 *  stamps its event when the link went; the two clocks also differ by up to a
 *  poll interval. A dish event or an event row within this much of the
 *  recorder's span still describes the same outage. */
export const MATCH_TOLERANCE_MS = 30_000;

/** The dish's heater flag: the one thing the dish asserts about snow melt on
 *  the LAN. `snowMeltActive` is not in the protoset and never decodes. */
export const HEATER_ALERT_KEY = "isHeating";

/** The recorder's episodes that mean a link outage: eight straight seconds of
 *  dropped pings, or a dish that stopped answering. */
export type OutageSourceKey = "starlinkOutage" | "dishUnreachable";

export function isOutageSourceKey(key: string): key is OutageSourceKey {
  return key === "starlinkOutage" || key === "dishUnreachable";
}

export interface BeforeDropStats {
  /** The five minutes before the link dropped, [start, drop). */
  windowStartMs: number;
  windowEndMs: number;
  /** Seconds of the window a recording actually covers: 300 is a full window
   *  at 1 Hz; the whole-minute fallback counts complete minutes only. */
  coverageSeconds: number;
  /** Mean dish-to-PoP latency. Null once the outage has aged past the sample
   *  window, since the per-minute rows carry no latency. */
  latencyAvgMs: number | null;
  downlinkAvgBps: number | null;
  uplinkAvgBps: number | null;
  /** Mean share of pings dropped across the covered seconds (0–1). */
  dropRateAvg: number | null;
  /** Whether the dish's heater ran at any point in the window, from the
   *  recorder's own isHeating episodes. */
  heaterActive: boolean;
  /** Which recording fed the numbers. */
  source: "samples" | "minute-buckets";
}

/** One dish alert episode, as the alert log records it. */
export interface ReportAlertEpisode {
  alertKey: string;
  startMs: number;
  /** Null while still running at generation time. */
  endMs: number | null;
}

/** The frozen summary of one ended outage. */
export interface OutageReport {
  /** `system:<source>:<episode start>`: one report per recorder episode. */
  id: string;
  source: OutageSourceKey;
  /** When the link dropped: the first dropped sample of the run that raised a
   *  starlinkOutage episode, which the recorder only notices eight seconds in. */
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Canonical cause from the dish's own event log, or null when the dish
   *  logged nothing for this outage (it never does while unreachable). */
  cause: string | null;
  beforeDrop: BeforeDropStats;
  /** Thermal episodes touching [start − 5 min, end]. */
  thermal: ReportAlertEpisode[];
  generatedAtMs: number;
}

export interface OutageReportInput {
  source: OutageSourceKey;
  /** The recorder episode's own start stamp. */
  startMs: number;
  endMs: number;
  dishEvents: OutageEvent[];
  /** The host's 1 s sample window, oldest first. */
  samples: TelemetrySample[];
  /** Per-minute rows overlapping the window, the fallback for an outage that
   *  has aged past the sample window. */
  minuteBuckets: MinuteBucket[];
  /** The dish's alert episodes within the alert log's window. */
  dishAlerts: ReportAlertEpisode[];
  generatedAtMs: number;
}

/** Below this much sample coverage the window has mostly aged out of the
 *  sample store and the per-minute rows describe it better. */
const MIN_SAMPLE_COVERAGE_SECONDS = 60;

function overlaps(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
  toleranceMs = 0,
): boolean {
  return aStartMs - toleranceMs <= bEndMs && bStartMs - toleranceMs <= aEndMs;
}

/** The recorder notices a ping-drop outage eight dropped seconds in. The drop
 *  itself is where the contiguous run of fully dropped samples ending at the
 *  episode's stamp begins. A dish-unreachable episode keeps its stamp: there
 *  are no samples to date it from. */
export function outageStartMs(
  source: OutageSourceKey,
  episodeStartMs: number,
  samples: readonly TelemetrySample[],
): number {
  if (source !== "starlinkOutage") return episodeStartMs;
  let startMs = episodeStartMs;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample.timestampMs > episodeStartMs) continue;
    if (sample.dropRate < 1) break;
    startMs = sample.timestampMs;
  }
  return startMs;
}

function causeOf(dishEvents: OutageEvent[], startMs: number, endMs: number): string | null {
  const matching = dishEvents.filter((event) =>
    overlaps(
      event.startMs,
      event.startMs + Math.max(event.durationMs, 0),
      startMs,
      endMs,
      MATCH_TOLERANCE_MS,
    ),
  );
  if (matching.length === 0) return null;
  matching.sort((a, b) => Math.abs(a.startMs - startMs) - Math.abs(b.startMs - startMs));
  return canonicalCause(matching[0].cause);
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function beforeDropFromSamples(
  samples: TelemetrySample[],
  startMs: number,
  heaterActive: boolean,
): BeforeDropStats {
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  const inWindow = samples.filter(
    (sample) => sample.timestampMs >= windowStartMs && sample.timestampMs < startMs,
  );
  return {
    windowStartMs,
    windowEndMs: startMs,
    coverageSeconds: inWindow.length,
    latencyAvgMs: mean(
      inWindow.flatMap((sample) => (sample.latencyMs === null ? [] : [sample.latencyMs])),
    ),
    downlinkAvgBps: mean(inWindow.map((sample) => sample.downlinkBps)),
    uplinkAvgBps: mean(inWindow.map((sample) => sample.uplinkBps)),
    dropRateAvg: mean(inWindow.map((sample) => sample.dropRate)),
    heaterActive,
    source: "samples",
  };
}

/** The whole-minute bucket the drop second falls in mixes pre-drop and dropped
 *  seconds, so only buckets whose minute lies entirely before it count. */
function beforeDropFromBuckets(
  buckets: MinuteBucket[],
  startMs: number,
  heaterActive: boolean,
): BeforeDropStats {
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  const windowStartSec = windowStartMs / 1000;
  const dropMinuteSec = Math.floor(startMs / 60_000) * 60;
  const inWindow = buckets.filter(
    (bucket) => bucket.minute >= windowStartSec && bucket.minute < dropMinuteSec,
  );
  const coverageSeconds = inWindow.reduce((sum, bucket) => sum + bucket.samples, 0);
  const downlinkBits = inWindow.reduce((sum, bucket) => sum + (bucket.downlinkBits ?? 0), 0);
  const uplinkBits = inWindow.reduce((sum, bucket) => sum + (bucket.uplinkBits ?? 0), 0);
  return {
    windowStartMs,
    windowEndMs: startMs,
    coverageSeconds,
    latencyAvgMs: null,
    downlinkAvgBps: coverageSeconds > 0 ? downlinkBits / coverageSeconds : null,
    uplinkAvgBps: coverageSeconds > 0 ? uplinkBits / coverageSeconds : null,
    dropRateAvg: null,
    heaterActive,
    source: "minute-buckets",
  };
}

export function buildOutageReport(input: OutageReportInput): OutageReport {
  const { source, endMs, dishEvents, samples, minuteBuckets, dishAlerts, generatedAtMs } = input;
  const startMs = outageStartMs(source, input.startMs, samples);
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  const episodeEnd = (episode: ReportAlertEpisode) => episode.endMs ?? generatedAtMs;

  const heaterActive = dishAlerts.some(
    (episode) =>
      episode.alertKey === HEATER_ALERT_KEY &&
      overlaps(episode.startMs, episodeEnd(episode), windowStartMs, startMs),
  );
  const sampleCoverage = samples.filter(
    (sample) => sample.timestampMs >= windowStartMs && sample.timestampMs < startMs,
  ).length;

  return {
    id: `system:${source}:${input.startMs}`,
    source,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    cause: causeOf(dishEvents, startMs, endMs),
    beforeDrop:
      sampleCoverage >= MIN_SAMPLE_COVERAGE_SECONDS
        ? beforeDropFromSamples(samples, startMs, heaterActive)
        : beforeDropFromBuckets(minuteBuckets, startMs, heaterActive),
    thermal: dishAlerts
      .filter(
        (episode) =>
          THERMAL_ALERT_KEYS.includes(episode.alertKey) &&
          overlaps(episode.startMs, episodeEnd(episode), windowStartMs, endMs),
      )
      .map(({ alertKey, startMs: episodeStartMs, endMs: episodeEndMs }) => ({
        alertKey,
        startMs: episodeStartMs,
        endMs: episodeEndMs,
      })),
    generatedAtMs,
  };
}

export interface ReportAssignment {
  /** The one report each owning event carries. */
  byEvent: Map<OutageEvent, OutageReport>;
  /** Reports no event owns. A dish that stopped answering logged no event for
   *  the time it was away, so its report needs a row of its own. */
  unclaimed: OutageReport[];
}

/**
 * Give each report to exactly one event row. Only an outage-kind event can own
 * one: a band switch, a router ping drop or a thermal row that happens to fall
 * inside an outage did not cause it, and showing it the outage's figures would
 * present them as its own. Among the outage events overlapping a report, the
 * one starting nearest the drop owns it; an event already owning a nearer
 * report is not offered a second.
 */
export function assignReports(
  reports: readonly OutageReport[],
  events: readonly OutageEvent[],
): ReportAssignment {
  const candidates = reports.flatMap((report) =>
    events
      .filter(
        (event) =>
          outageEventKind(event.cause) === "outage" &&
          overlaps(
            report.startMs,
            report.endMs,
            event.startMs,
            event.startMs + Math.max(event.durationMs, 0),
            MATCH_TOLERANCE_MS,
          ),
      )
      .map((event) => ({ report, event, distance: Math.abs(report.startMs - event.startMs) })),
  );
  candidates.sort((a, b) => a.distance - b.distance);

  const byEvent = new Map<OutageEvent, OutageReport>();
  const assigned = new Set<string>();
  for (const { report, event } of candidates) {
    if (assigned.has(report.id) || byEvent.has(event)) continue;
    byEvent.set(event, report);
    assigned.add(report.id);
  }
  return { byEvent, unclaimed: reports.filter((report) => !assigned.has(report.id)) };
}
