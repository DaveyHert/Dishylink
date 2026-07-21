// Persistent per-minute log of each connected device's throughput.
//
// The router serves only an instantaneous rate — no history — so per-device
// charts were built from whatever the browser happened to observe while the
// Network sheet sat open, and were lost on every reload. That is fine for a
// pet dashboard and useless for a product: the device that saturated the link
// last night is exactly the one you want to look up this morning.
//
// This records the same rates the panel polls, but from the always-on
// historian, so the series exists whether or not anyone is looking. Keyed by MAC.
//
// Byte counters ride along for per-device totals. They are cumulative *within an
// association only* — the router restarts them when a device reconnects — so a
// later row's rxBytes may be lower than an earlier one. Any consumer computing
// deltas has to treat a decrease as a reconnect, not as negative traffic.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClientReading {
  macAddress: string;
  /** Name the router reports, kept so history survives a device going away. */
  name?: string;
  downMbps: number;
  upMbps: number;
  /** Cumulative since *this* association — resets when the device reconnects. */
  rxBytes: number;
  txBytes: number;
}

export interface ClientMinute {
  /** Epoch seconds at the minute's start. */
  minute: number;
  macAddress: string;
  name?: string;
  /** Mean rate over the minute. */
  downMbps: number;
  upMbps: number;
  /** Peak rate within the minute — an average hides the spike that mattered. */
  downPeakMbps: number;
  upPeakMbps: number;
  rxBytes: number;
  txBytes: number;
}

/**
 * Per-device detail is kept for the same six hours the dish samples are — the
 * per-device chart shows 15 minutes and nothing can display more than 6h. A
 * longer window would store rows no view can draw. At 8 devices this is ~2,880
 * rows (~300 kB), so the simple append log stays honest here.
 */
const RETENTION_HOURS = 6;

interface PendingBucket {
  minute: number;
  macAddress: string;
  name?: string;
  downSum: number;
  upSum: number;
  downPeak: number;
  upPeak: number;
  count: number;
  rxBytes: number;
  txBytes: number;
}

export class ClientStore {
  private pending = new Map<string, PendingBucket>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.compact();
  }

  private readAll(): ClientMinute[] {
    if (!existsSync(this.filePath)) return [];
    const rows: ClientMinute[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        rows.push(JSON.parse(line) as ClientMinute);
      } catch {
        // skip a torn final line from a crash mid-write
      }
    }
    return rows;
  }

  /** Drop rows past the retention window so the log cannot grow without bound. */
  compact(): number {
    if (!existsSync(this.filePath)) return 0;
    const all = this.readAll();
    const cutoffSec = Math.floor(Date.now() / 1000) - RETENTION_HOURS * 3_600;
    const kept = all.filter((row) => row.minute >= cutoffSec);
    const dropped = all.length - kept.length;
    if (dropped === 0) return 0;
    const body = kept.map((row) => JSON.stringify(row)).join("\n");
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
    return dropped;
  }

  /** Fold a poll into the current minute, writing out any minute that has closed. */
  ingest(readings: ClientReading[], nowMs: number): void {
    const minute = Math.floor(nowMs / 60_000) * 60;
    const completed: ClientMinute[] = [];
    for (const [key, bucket] of this.pending) {
      if (bucket.minute >= minute) continue;
      completed.push({
        minute: bucket.minute,
        macAddress: bucket.macAddress,
        name: bucket.name,
        downMbps: round3(bucket.downSum / Math.max(bucket.count, 1)),
        upMbps: round3(bucket.upSum / Math.max(bucket.count, 1)),
        downPeakMbps: round3(bucket.downPeak),
        upPeakMbps: round3(bucket.upPeak),
        rxBytes: bucket.rxBytes,
        txBytes: bucket.txBytes,
      });
      this.pending.delete(key);
    }
    if (completed.length > 0) {
      appendFileSync(this.filePath, completed.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    for (const reading of readings) {
      if (!reading.macAddress) continue;
      const key = `${minute}:${reading.macAddress}`;
      const bucket = this.pending.get(key) ?? {
        minute,
        macAddress: reading.macAddress,
        name: reading.name,
        downSum: 0,
        upSum: 0,
        downPeak: 0,
        upPeak: 0,
        count: 0,
        rxBytes: reading.rxBytes,
        txBytes: reading.txBytes,
      };
      bucket.downSum += reading.downMbps;
      bucket.upSum += reading.upMbps;
      bucket.downPeak = Math.max(bucket.downPeak, reading.downMbps);
      bucket.upPeak = Math.max(bucket.upPeak, reading.upMbps);
      bucket.count += 1;
      bucket.rxBytes = reading.rxBytes;
      bucket.txBytes = reading.txBytes;
      if (reading.name) bucket.name = reading.name;
      this.pending.set(key, bucket);
    }
  }

  /** Persisted rows from the last `hours`, oldest first. Optionally one device. */
  history(hours: number, macAddress?: string): ClientMinute[] {
    const cutoffSec = Math.floor(Date.now() / 1000) - hours * 3_600;
    return this.readAll()
      .filter((row) => row.minute >= cutoffSec && (!macAddress || row.macAddress === macAddress))
      .sort((a, b) => a.minute - b.minute);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
