// Rolling window of raw per-device throughput samples, one per second.
//
// The companion to ClientStore, and the reason the per-device chart is dense the
// moment it opens rather than filling in as you watch. ClientStore folds every
// sample into a per-minute bucket at ingest — right for its 6h window, but it
// leaves a 15-minute chart with ~15 points to draw.
//
// So samples stay unaggregated here for a short window: two tiers, the same shape
// the historian uses for dish telemetry (SAMPLE_WINDOW_MS + the samples.json
// snapshot) — full resolution recently, per-minute further back.
//
// In memory plus a periodic snapshot, not an append log: the window is small,
// every sample expires within the hour, and a torn tail costs at most a restart's
// worth of detail.

import { existsSync, readFileSync } from "node:fs";
import { ensureParentDirectory, writeJsonAtomically } from "./jsonLinesFile.mts";
import type { ClientReading } from "./clientStore.mts";

export interface ClientSample {
  /** Device identity — clientId, matching ClientReading. Absent only on samples
   *  restored from a snapshot written before per-device keying. */
  key?: string;
  macAddress: string;
  /** Epoch milliseconds. */
  atMs: number;
  downMbps: number;
  upMbps: number;
}

/** Long enough to fill the 15-minute detail chart with headroom for a stale
 *  seed, short enough that the whole window stays small in memory. */
const WINDOW_MS = 30 * 60_000;

/** Three decimals is ~1 kbps of resolution — finer than anything the chart can
 *  draw, and it keeps the snapshot small. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The map bucket a sample lives in: its device key, or — for samples restored
 *  from a pre-keying snapshot — the MAC, which is what a legacy lookup asks for. */
function seriesKey(sample: ClientSample): string {
  return sample.key ?? sample.macAddress;
}

export class ClientWindow {
  private series = new Map<string, ClientSample[]>();

  constructor(private readonly filePath: string) {
    ensureParentDirectory(filePath);
    this.restore();
  }

  private restore(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const persisted = JSON.parse(readFileSync(this.filePath, "utf8")) as ClientSample[];
      this.ingestSamples(persisted, Date.now());
    } catch {
      // unreadable snapshot: start empty rather than refuse to boot
    }
  }

  private ingestSamples(samples: ClientSample[], nowMs: number): void {
    const cutoffMs = nowMs - WINDOW_MS;
    for (const sample of samples) {
      if (sample.atMs < cutoffMs) continue;
      const key = seriesKey(sample);
      const series = this.series.get(key) ?? [];
      series.push(sample);
      this.series.set(key, series);
    }
    for (const series of this.series.values()) series.sort((a, b) => a.atMs - b.atMs);
  }

  /** Record one poll's readings and drop whatever has aged out. */
  ingest(readings: ClientReading[], nowMs: number): void {
    const cutoffMs = nowMs - WINDOW_MS;
    for (const reading of readings) {
      const series = this.series.get(reading.key) ?? [];
      series.push({
        key: reading.key,
        macAddress: reading.macAddress,
        atMs: nowMs,
        downMbps: round(reading.downMbps),
        upMbps: round(reading.upMbps),
      });
      // Samples arrive in time order, so the expired ones are always a prefix.
      let firstLive = 0;
      while (firstLive < series.length && series[firstLive].atMs < cutoffMs) firstLive++;
      this.series.set(reading.key, firstLive > 0 ? series.slice(firstLive) : series);
    }
    // A device that has gone away stops being written to, so its series would
    // otherwise sit at full length forever.
    for (const [key, series] of this.series) {
      if (series.length > 0 && series[series.length - 1].atMs < cutoffMs) this.series.delete(key);
    }
  }

  /**
   * Samples oldest first; all devices when `key` is absent.
   *
   * Samples restored from a pre-keying snapshot carry no `key` and sit under
   * their MAC, so they come back only in the unfiltered call — the one the
   * `/api/clients` handler makes, which is where they get attributed.
   *
   * `sinceMs` returns only what is newer, so a caller polling every second asks
   * for the whole window once and then a handful of samples per request instead
   * of re-sending thirty minutes of history each time.
   */
  samples(key?: string, sinceMs?: number): ClientSample[] {
    const cutoffMs = Math.max(Date.now() - WINDOW_MS, sinceMs ?? 0);
    if (key) return (this.series.get(key) ?? []).filter((sample) => sample.atMs > cutoffMs);

    // Each series is already ascending (ingest() appends in time order,
    // ingestSamples() sorts on restore), so walking from the end and
    // stopping at the first stale sample finds exactly the live tail. The
    // per-series walks land in Map iteration order, not time order, so the
    // merged result still needs a final sort before it can be returned.
    const collected: ClientSample[] = [];
    for (const series of this.series.values()) {
      for (let index = series.length - 1; index >= 0; index--) {
        if (series[index].atMs <= cutoffMs) break;
        collected.push(series[index]);
      }
    }
    return collected.sort((a, b) => a.atMs - b.atMs);
  }

  /** Persist so a historian restart does not blank the chart. */
  snapshot(): void {
    const all = this.samples();
    if (all.length === 0) return;
    try {
      writeJsonAtomically(this.filePath, all);
    } catch {
      // a failed snapshot costs detail after a restart, never the live window
    }
  }
}
