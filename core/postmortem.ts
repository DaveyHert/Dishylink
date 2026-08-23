// Outage post-mortem synthesis.
//
// Everything the report states is already recorded — the recorder never asks the
// devices anything new. The moment a link outage ends (the recorder's own
// starlinkOutage / dishUnreachable episode clears), this folds the recordings
// around it into one self-contained summary: when it happened and for how long,
// what the dish's own event log says caused it, the latency/throughput of the
// five minutes before the drop, whether snow melt was running, and any thermal
// state touching the outage.
//
// Pure and IO-free, so the recorder and the UI agree on what an outage means:
// the recorder generates the report and the dashboard renders the same shape
// the API serves.

import { canonicalCause, type OutageEvent, type TelemetrySample } from "./telemetry";
import type { MinuteBucket } from "./energyBuckets";

/** How far back before the drop the report looks for "what the link was doing". */
export const BEFORE_WINDOW_MS = 5 * 60_000;

/** The names of the recorder's own episodes that mean a link outage. The dish's
 *  event-log entries (eventStore) describe what happened; these episodes are
 *  what the recorder can time precisely, because it opens and closes them. */
export type OutageSourceKey = "starlinkOutage" | "dishUnreachable";

export interface BeforeDropStats {
  /** The five minutes of recording before the link dropped, [start, drop). */
  windowStartMs: number;
  windowEndMs: number;
  /** Seconds of the window actually covered by a recording — the honesty number
   *  behind every average. 300 is a fully covered window at 1 Hz; the
   *  minute-row fallback counts whole minutes only, so its fully covered window
   *  is 240–300 s depending on where in the minute the drop landed. */
  coverageSeconds: number;
  /** Mean dish → PoP ping latency (ms). Null once the outage is older than the
   *  6 h sample window: the per-minute rows that reach back further carry no
   *  latency. */
  latencyAvgMs: number | null;
  downlinkAvgBps: number | null;
  uplinkAvgBps: number | null;
  /** Mean share of pings dropped across the covered seconds (0–1). */
  dropRateAvg: number | null;
  /** Two-state on purpose: get_status omits a false snowMeltActive field, so
   *  "active" is the only state the dish ever asserts outright, and the
   *  recorder's only producer normalizes everything else to an absent field. A
   *  window with no assertion — or with a recorded false, which the current
   *  producer chain cannot even emit — reads "unknown", never "off". */
  snowMelt: "active" | "unknown";
  /** Which recording fed the numbers: the 1 s sample window when it reaches
   *  back to the pre-drop minutes, else the per-minute energy rows. */
  source: "samples" | "minute-buckets";
}

/** One thermal episode touching the outage, from the thermal log. */
export interface ReportThermalEpisode {
  alertKey: string;
  startMs: number;
  /** Null while still running — the report freezes the episode as it was. */
  endMs: number | null;
}

/** The auto-generated summary of one ended outage. This JSON is the shareable
 *  artifact: it is self-contained (every number it states was frozen at
 *  generation time) and rides the `/api/outages/reports` list newest-first. */
export interface OutageReport {
  /** Identity of the closed episode that ended the outage —
   *  `system:starlinkOutage:<startMs>` — keyed so a report is never generated
   *  twice for the same outage. */
  id: string;
  /** Which recorder episode ended: sample-based (eight consecutive dropped
   *  seconds) or dish-unreachable. */
  source: OutageSourceKey;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Canonical cause token from the dish's own event log (see canonicalCause),
   *  when an event overlaps the outage; null when the dish never reported one. */
  cause: string | null;
  beforeDrop: BeforeDropStats;
  /** Thermal episodes touching [start − 5 min, end]: a shutdown that began
   *  before the drop — the classic staged failure — still shows. */
  thermal: ReportThermalEpisode[];
  generatedAtMs: number;
}

export interface OutageReportInput {
  source: OutageSourceKey;
  startMs: number;
  endMs: number;
  /** The dish's event-log entries held by the event store, for the cause. */
  dishEvents: OutageEvent[];
  /** The recorder's 1 s sample window (covers ~6 h; silence inside it occupies
   *  room, so a long outage leaves the pre-drop seconds only while recent). */
  samples: TelemetrySample[];
  /** Per-minute energy rows for the window — the fallback for outages that have
   *  aged past the sample window. Minutes are the whole-minute span their
   *  bucket covers; the caller hands over the ones overlapping the window, and
   *  the drop-minute bucket is excluded here regardless of how it was asked
   *  for. */
  minuteBuckets: MinuteBucket[];
  /** The thermal log, whole — overlap with the outage is judged here. */
  thermal: ReportThermalEpisode[];
  generatedAtMs: number;
}

/** Below this many sample-seconds covering the window, the sample window is no
 *  longer the honest source: it usually means the window's start has aged out,
 *  and the per-minute rows describe it better. Whole-minute rows count only the
 *  minutes fully inside the window — the partial minute the window starts in
 *  and the drop-minute bucket are both left out — so a fully recorded window is
 *  300 s only when the drop lands on a minute boundary; the usual drop reads
 *  240 s (four whole minutes). */
const MIN_SAMPLE_COVERAGE_SECONDS = 60;

/** The cause the dish's event log assigns, or null when none of its events
 *  overlaps the outage. The recorder detects the drop up to a few seconds after
 *  the dish's own start stamp, so the match tolerates that, and ties go to the
 *  event whose start is nearest the recorder's. */
function causeOf(dishEvents: OutageEvent[], startMs: number, endMs: number): string | null {
  const overlapping = dishEvents.filter(
    (event) =>
      // Interval overlap, with the recorder's start tolerance and the same
      // five-minute lookback the thermal check uses.
      Math.max(event.startMs, startMs - BEFORE_WINDOW_MS) <=
      Math.min(event.startMs + Math.max(event.durationMs, 0), endMs),
  );
  if (overlapping.length === 0) return null;
  return canonicalCause(
    overlapping.sort((a, b) => Math.abs(a.startMs - startMs) - Math.abs(b.startMs - startMs))[0]
      .cause,
  );
}

/** Window verdict: any asserted active wins; everything else — silence, or a
 *  recorded false, which today's producer chain cannot even emit — reads
 *  "unknown" (see BeforeDropStats.snowMelt). Claiming "off" would assert
 *  something the reply never said. */
function snowMeltOf(samples: TelemetrySample[]): "active" | "unknown" {
  for (const sample of samples) {
    if (sample.snowMeltActive === true) return "active";
  }
  return "unknown";
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** The five minutes before the drop from the 1 s window: averages over the
 *  seconds it actually covered. Null fields mean the field exists on the
 *  samples but every reading for the window was null, not "not recorded". */
function beforeDropFromSamples(samples: TelemetrySample[], startMs: number): BeforeDropStats {
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  const inWindow = samples.filter(
    (sample) => sample.timestampMs >= windowStartMs && sample.timestampMs < startMs,
  );
  const latencies = inWindow.flatMap((sample) =>
    sample.latencyMs === null ? [] : [sample.latencyMs],
  );
  return {
    windowStartMs,
    windowEndMs: startMs,
    coverageSeconds: inWindow.length,
    latencyAvgMs: mean(latencies),
    downlinkAvgBps: mean(inWindow.map((sample) => sample.downlinkBps)),
    uplinkAvgBps: mean(inWindow.map((sample) => sample.uplinkBps)),
    dropRateAvg: mean(inWindow.map((sample) => sample.dropRate)),
    snowMelt: snowMeltOf(inWindow),
    source: "samples",
  };
}

/** The fallback for outages that have aged past the sample window: the
 *  per-minute rows sum the same downlink/uplink bits (one row per wall-clock
 *  minute) with the seconds they covered. Latency and snow melt are not in
 *  those rows, so they stay null/unknown rather than being invented. */
function beforeDropFromBuckets(buckets: MinuteBucket[], startMs: number): BeforeDropStats {
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  // Bucket minutes are whole-minute epoch seconds; the window bounds are ms.
  const windowStartSec = windowStartMs / 1000;
  // The whole-minute bucket the drop second falls in is excluded no matter how
  // the caller asked: it mixes pre-drop and dropped seconds, and its start can
  // precede the drop stamp (only a drop exactly on the minute boundary makes
  // the naive `bucket.minute < startMs / 1000` cut). A bucket whose minute
  // start lies inside the window is then a whole minute fully inside it.
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
    snowMelt: "unknown",
    source: "minute-buckets",
  };
}

/** Fold the recordings around one ended outage into the report. Pure — the
 *  caller supplies everything; this decides what the outage means. */
export function buildOutageReport(input: OutageReportInput): OutageReport {
  const { source, startMs, endMs, dishEvents, samples, minuteBuckets, thermal, generatedAtMs } =
    input;
  const windowStartMs = startMs - BEFORE_WINDOW_MS;
  const sampleCoverage = samples.filter(
    (sample) => sample.timestampMs >= windowStartMs && sample.timestampMs < startMs,
  ).length;

  const beforeDrop =
    sampleCoverage >= MIN_SAMPLE_COVERAGE_SECONDS
      ? beforeDropFromSamples(samples, startMs)
      : beforeDropFromBuckets(minuteBuckets, startMs);

  return {
    id: `system:${source}:${startMs}`,
    source,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    cause: causeOf(dishEvents, startMs, endMs),
    beforeDrop,
    thermal: thermal
      .filter(
        (episode) =>
          episode.startMs <= endMs && (episode.endMs === null || episode.endMs >= windowStartMs),
      )
      .map(({ alertKey, startMs: episodeStartMs, endMs: episodeEndMs }) => ({
        alertKey,
        startMs: episodeStartMs,
        endMs: episodeEndMs,
      })),
    generatedAtMs,
  };
}
