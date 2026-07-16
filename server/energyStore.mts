// Persistent per-minute energy store, dependency-free (NDJSON append log).
//
// One line per *completed* wall-clock minute: { minute, wattSeconds, samples }.
// `minute` is epoch seconds at the minute's start. `samples` counts the
// per-second readings actually collected for that minute (≤60) — so gaps in
// collection show up as low sample counts rather than fabricated energy.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TelemetrySample } from "../src/lib/telemetry.ts";

export interface MinuteBucket {
  minute: number;
  wattSeconds: number;
  samples: number;
  /** Downlink/uplink volume in bits (absent on rows written before data-usage tracking). */
  dlBits?: number;
  ulBits?: number;
}

/** Group per-second samples into per-minute energy+traffic buckets. Each sample ≈ 1s. */
export function foldSamplesToMinutes(samples: TelemetrySample[]): Map<number, MinuteBucket> {
  const buckets = new Map<number, MinuteBucket>();
  for (const sample of samples) {
    const minute = Math.floor(sample.timestampMs / 60_000) * 60;
    const bucket = buckets.get(minute) ?? { minute, wattSeconds: 0, samples: 0, dlBits: 0, ulBits: 0 };
    bucket.wattSeconds += sample.powerW ?? 0;
    // per-second sample: bps over one second ≈ bits transferred
    bucket.dlBits = (bucket.dlBits ?? 0) + (sample.downlinkBps ?? 0);
    bucket.ulBits = (bucket.ulBits ?? 0) + (sample.uplinkBps ?? 0);
    bucket.samples += 1;
    buckets.set(minute, bucket);
  }
  return buckets;
}

/**
 * How far back minutes are kept. The month view reaches back twelve calendar
 * months, so this has to clear a year comfortably — a shorter window would
 * quietly hollow out the oldest bars rather than just save disk.
 */
const RETENTION_DAYS = 400;

export class EnergyStore {
  private maxWrittenMinute = -1;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.compact();
    for (const bucket of this.readAll()) {
      if (bucket.minute > this.maxWrittenMinute) this.maxWrittenMinute = bucket.minute;
    }
  }

  /**
   * Drop minutes past the retention window. The log is append-only and one line
   * per minute — roughly half a million lines a year — so without this it grows
   * without bound for history nothing can display.
   */
  compact(): number {
    if (!existsSync(this.filePath)) return 0;
    const all = this.readAll();
    const cutoffSec = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86_400;
    const kept = all.filter((bucket) => bucket.minute >= cutoffSec);
    const dropped = all.length - kept.length;
    if (dropped === 0) return 0;
    const body = kept.map((bucket) => JSON.stringify(bucket)).join("\n");
    // temp + rename so a crash mid-write never tears the log
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
    return dropped;
  }

  /** Newest minute already persisted; incoming samples at/below this are ignored to avoid double-counting on restart. */
  get lastWrittenMinute(): number {
    return this.maxWrittenMinute;
  }

  append(bucket: MinuteBucket): void {
    appendFileSync(this.filePath, JSON.stringify(bucket) + "\n");
    if (bucket.minute > this.maxWrittenMinute) this.maxWrittenMinute = bucket.minute;
  }

  private readAll(): MinuteBucket[] {
    if (!existsSync(this.filePath)) return [];
    const buckets: MinuteBucket[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        buckets.push(JSON.parse(line) as MinuteBucket);
      } catch {
        // skip a torn final line from a crash mid-write
      }
    }
    return buckets;
  }

  /** Persisted buckets whose minute falls in [startSec, endSec). */
  readRange(startSec: number, endSec: number): MinuteBucket[] {
    return this.readAll().filter((bucket) => bucket.minute >= startSec && bucket.minute < endSec);
  }
}
