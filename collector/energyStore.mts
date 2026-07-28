// Persistent per-minute energy store, dependency-free (JSON Lines append log).
//
// One line per *completed* wall-clock minute: { minute, wattSeconds, samples }.
// `minute` is epoch seconds at the minute's start. `samples` counts the
// per-second readings actually collected for that minute (≤60) — so gaps in
// collection show up as low sample counts rather than fabricated energy.
//
// Retention follows the calendar, the way Starlink's own usage page does:
// per-minute detail for the current year only. Older minutes are not deleted —
// they are folded into one row per month (see MonthBucket) before the minutes
// go. A year of minutes is ~525k lines to answer "how much in March"; the
// rollup answers it with one, and nothing any view can draw is lost.

import {
  appendJsonLines,
  ensureParentDirectory,
  readJsonLines,
  writeJsonLinesAtomically,
} from "./jsonLinesFile.mts";
import { foldSamplesToMinutes, type MinuteBucket } from "../core/energyBuckets.ts";

// The fold primitive and the minute-bucket shape are shared with the extension,
// so they live in core; re-exported here because this store and the historian
// have always reached for them by this name.
export { foldSamplesToMinutes, type MinuteBucket };

/** One archived calendar month, folded from that month's minutes. */
export interface MonthBucket {
  /** Epoch seconds at the local start of the month. */
  month: number;
  wattSeconds: number;
  /** Minutes actually recorded that month — the honesty check on a summary. */
  samples: number;
  dlBits: number;
  ulBits: number;
}

/** Local start of the current calendar year, epoch seconds. */
function startOfYearSec(now: Date): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setMonth(0, 1);
  return Math.floor(date.getTime() / 1000);
}

/** Local start of the calendar month a minute falls in, epoch seconds. */
function monthKeyOf(minuteSec: number): number {
  const date = new Date(minuteSec * 1000);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return Math.floor(date.getTime() / 1000);
}

export class EnergyStore {
  private maxWrittenMinute = -1;
  /** Sibling log holding one row per archived month. */
  private readonly monthlyPath: string;

  constructor(private readonly filePath: string) {
    this.monthlyPath = filePath.replace(/\.ndjson$/, "") + "-monthly.ndjson";
    ensureParentDirectory(filePath);
    this.compact();
    for (const bucket of this.readAll()) {
      if (bucket.minute > this.maxWrittenMinute) this.maxWrittenMinute = bucket.minute;
    }
  }

  /**
   * Keep per-minute detail for the current calendar year; fold everything older
   * into monthly rows first, so a year rollover summarises last year rather than
   * erasing it. Idempotent: a month already archived is not written twice.
   */
  compact(): number {
    const all = this.readAll();
    const cutoffSec = startOfYearSec(new Date());
    const kept = all.filter((bucket) => bucket.minute >= cutoffSec);
    const expired = all.filter((bucket) => bucket.minute < cutoffSec);
    if (expired.length === 0) return 0;

    const archived = new Set(this.readMonths().map((row) => row.month));
    const folded = new Map<number, MonthBucket>();
    for (const bucket of expired) {
      const month = monthKeyOf(bucket.minute);
      if (archived.has(month)) continue; // already summarised on an earlier run
      const row = folded.get(month) ?? { month, wattSeconds: 0, samples: 0, dlBits: 0, ulBits: 0 };
      row.wattSeconds += bucket.wattSeconds;
      row.samples += bucket.samples;
      row.dlBits += bucket.dlBits ?? 0;
      row.ulBits += bucket.ulBits ?? 0;
      folded.set(month, row);
    }
    appendJsonLines(
      this.monthlyPath,
      [...folded.values()].sort((a, b) => a.month - b.month),
    );

    writeJsonLinesAtomically(this.filePath, kept);
    return expired.length;
  }

  /** Archived monthly summaries, oldest first. Cheap: one row per month. */
  readMonths(): MonthBucket[] {
    return readJsonLines<MonthBucket>(this.monthlyPath).sort((a, b) => a.month - b.month);
  }

  /** Newest minute already persisted; incoming samples at/below this are ignored to avoid double-counting on restart. */
  get lastWrittenMinute(): number {
    return this.maxWrittenMinute;
  }

  append(bucket: MinuteBucket): void {
    appendJsonLines(this.filePath, [bucket]);
    if (bucket.minute > this.maxWrittenMinute) this.maxWrittenMinute = bucket.minute;
  }

  private readAll(): MinuteBucket[] {
    return readJsonLines<MinuteBucket>(this.filePath);
  }

  /** Persisted buckets whose minute falls in [startSec, endSec). */
  readRange(startSec: number, endSec: number): MinuteBucket[] {
    return this.readAll().filter((bucket) => bucket.minute >= startSec && bucket.minute < endSec);
  }
}
