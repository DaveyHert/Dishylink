// Persistent per-minute log of the router's Wi-Fi radio temperatures.
//
// These are the only real temperatures anything on this network will tell us.
// The dish reports thermal trouble as bare booleans and no number; the router's
// better sensors (board, CPU, ambient, PoE die) only ride the hourly metrics
// message, which no local RPC serves. What is left is one on-chip sensor per
// radio, from the router's get_radio_stats, and nothing recorded it before.
//
// The duty cycle beside each reading is what makes the number useful: it is the
// share of airtime the radio is allowed, and the router cuts it to cool a hot
// chip. Temperature climbing while duty cycle falls is Wi-Fi being slow
// *because* of heat — the reading and its consequence, kept together.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface RadioReading {
  /** e.g. "RF_2GHZ", "RF_5GHZ", "RF_5GHZ_HIGH". */
  band: string;
  /** On-chip sensor. The router states no unit; this is degrees Celsius by every sane reading. */
  tempC: number;
  /** Percent of airtime the radio may transmit; the router cuts this to cool down. */
  dutyCycle: number;
}

export interface RadioMinute extends RadioReading {
  /** Epoch seconds at the minute's start. */
  minute: number;
}

const RETENTION_DAYS = 30;

export class RadioStore {
  /** Per-minute accumulator for the minute still in progress. */
  private pending = new Map<string, { sum: number; count: number; dutyMin: number; minute: number; band: string }>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.compact();
  }

  private readAll(): RadioMinute[] {
    if (!existsSync(this.filePath)) return [];
    const rows: RadioMinute[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        rows.push(JSON.parse(line) as RadioMinute);
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
    const cutoffSec = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86_400;
    const kept = all.filter((row) => row.minute >= cutoffSec);
    const dropped = all.length - kept.length;
    if (dropped === 0) return 0;
    const body = kept.map((row) => JSON.stringify(row)).join("\n");
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
    return dropped;
  }

  /**
   * Fold a poll into the current minute, writing out any minute that has now
   * closed. Averages temperature over the minute but keeps the *lowest* duty
   * cycle seen: a brief cut back is the event worth remembering, and averaging
   * would smooth it away.
   */
  ingest(readings: RadioReading[], nowMs: number): void {
    const minute = Math.floor(nowMs / 60_000) * 60;
    const completed: RadioMinute[] = [];
    for (const [key, bucket] of this.pending) {
      if (bucket.minute >= minute) continue;
      completed.push({
        minute: bucket.minute,
        band: bucket.band,
        tempC: Math.round((bucket.sum / Math.max(bucket.count, 1)) * 10) / 10,
        dutyCycle: bucket.dutyMin,
      });
      this.pending.delete(key);
    }
    if (completed.length > 0) {
      appendFileSync(this.filePath, completed.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    for (const reading of readings) {
      const key = `${minute}:${reading.band}`;
      const bucket = this.pending.get(key) ?? {
        sum: 0,
        count: 0,
        dutyMin: reading.dutyCycle,
        minute,
        band: reading.band,
      };
      bucket.sum += reading.tempC;
      bucket.count += 1;
      bucket.dutyMin = Math.min(bucket.dutyMin, reading.dutyCycle);
      this.pending.set(key, bucket);
    }
  }

  /** Persisted rows from the last `hours`, oldest first. */
  history(hours: number): RadioMinute[] {
    const cutoffSec = Math.floor(Date.now() / 1000) - hours * 3_600;
    return this.readAll()
      .filter((row) => row.minute >= cutoffSec)
      .sort((a, b) => a.minute - b.minute);
  }
}
