// Decoding of the dish's telemetry ring buffer into an absolute-time series,
// plus an accumulator that stitches successive polls into a longer window
// than the 15 minutes the dish itself retains.

import type { DishHistoryJson, DishOutageJson, DishEventJson } from "./dishClient";

export interface TelemetrySample {
  timestampMs: number;
  latencyMs: number | null;
  dropRate: number;
  downlinkBps: number;
  uplinkBps: number;
  powerW: number;
}

export interface OutageEvent {
  startMs: number;
  durationMs: number;
  cause: string;
  severity: "advisory" | "warning" | "critical";
}

/**
 * The `outages[]` timestamps use the GPS epoch (1980-01-06, no leap seconds);
 * `eventLog` uses the Unix epoch. Offset = Unix seconds at GPS epoch minus
 * the 18 leap seconds accumulated since. Verified against this dish: the same
 * outage appears in both lists exactly this far apart.
 */
const GPS_TO_UNIX_OFFSET_NS = BigInt(315_964_800 - 18) * 1_000_000_000n;

function gpsNsToUnixMs(gpsTimestampNs: string): number {
  return Number((BigInt(gpsTimestampNs) + GPS_TO_UNIX_OFFSET_NS) / 1_000_000n);
}

function unixNsToMs(unixTimestampNs: string): number {
  return Number(BigInt(unixTimestampNs) / 1_000_000n);
}

function humanizeEnumTail(enumValue: string, prefix: string): string {
  const trimmed = enumValue.startsWith(prefix) ? enumValue.slice(prefix.length) : enumValue;
  return trimmed.replaceAll("_", " ").toLowerCase();
}

/**
 * Unroll the dish's ring buffer. `current` counts samples written since boot;
 * each array holds the last `arrayLength` samples at one sample per second,
 * where absolute sample counter `c` lives at index `c % arrayLength`. The
 * newest sample is pinned to `nowMs`.
 */
export function decodeHistoryWindow(
  history: DishHistoryJson,
  nowMs: number,
): { samples: TelemetrySample[]; newestCounter: number } {
  const newestCounter = Number(history.current ?? 0);
  const latencies = history.popPingLatencyMs ?? [];
  const arrayLength = latencies.length;
  if (arrayLength === 0 || newestCounter === 0) return { samples: [], newestCounter };

  const sampleCount = Math.min(newestCounter, arrayLength);
  const samples: TelemetrySample[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const absoluteCounter = newestCounter - sampleCount + sampleIndex;
    const ringIndex = absoluteCounter % arrayLength;
    const latencyMs = latencies[ringIndex];
    samples.push({
      timestampMs: nowMs - (sampleCount - 1 - sampleIndex) * 1000,
      latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : null,
      dropRate: history.popPingDropRate?.[ringIndex] ?? 0,
      downlinkBps: history.downlinkThroughputBps?.[ringIndex] ?? 0,
      uplinkBps: history.uplinkThroughputBps?.[ringIndex] ?? 0,
      powerW: history.powerIn?.[ringIndex] ?? 0,
    });
  }
  return { samples, newestCounter };
}

export function decodeOutageEvents(history: DishHistoryJson): OutageEvent[] {
  const eventLogEntries = history.eventLog?.events ?? [];
  if (eventLogEntries.length > 0) {
    return eventLogEntries.map((event: DishEventJson) => ({
      startMs: unixNsToMs(event.startTimestampNs ?? "0"),
      durationMs: Number(BigInt(event.durationNs ?? "0") / 1_000_000n),
      cause: humanizeEnumTail(event.reason ?? "", "EVENT_REASON_"),
      severity:
        event.severity === "EVENT_SEVERITY_CRITICAL"
          ? "critical"
          : event.severity === "EVENT_SEVERITY_WARNING"
            ? "warning"
            : "advisory",
    }));
  }
  return (history.outages ?? []).map((outage: DishOutageJson) => ({
    startMs: gpsNsToUnixMs(outage.startTimestampNs ?? "0"),
    durationMs: Number(BigInt(outage.durationNs ?? "0") / 1_000_000n),
    cause: humanizeEnumTail(outage.cause ?? "", ""),
    severity: "warning",
  }));
}

/** Stitches ring-buffer polls into one continuous capped series. */
export class TelemetryAccumulator {
  private samples: TelemetrySample[] = [];
  private newestCounter = 0;

  constructor(private readonly maxSamples: number) {}

  ingest(history: DishHistoryJson, nowMs: number): TelemetrySample[] {
    const window = decodeHistoryWindow(history, nowMs);
    if (window.samples.length === 0) return this.samples;

    // A counter reset means the dish rebooted — start the series over.
    if (window.newestCounter < this.newestCounter) this.samples = [];

    const freshSampleCount =
      this.newestCounter === 0 || this.samples.length === 0
        ? window.samples.length
        : Math.min(window.newestCounter - this.newestCounter, window.samples.length);
    this.samples.push(...window.samples.slice(window.samples.length - freshSampleCount));
    this.newestCounter = window.newestCounter;

    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(this.samples.length - this.maxSamples);
    }
    return this.samples;
  }
}
