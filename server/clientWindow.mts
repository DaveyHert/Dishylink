// Rolling window of raw per-device throughput samples, one per second.
//
// The companion to ClientStore, and the reason the per-device chart can be dense
// the moment it opens. ClientStore folds every sample into a per-minute bucket
// at ingest — right for its 6h window, but it means a 15-minute chart drawn from
// it has ~15 points. The browser used to make up the difference by sampling the
// router itself, which only produced detail for the stretch someone happened to
// be watching, and left the rest coarse.
//
// This keeps the samples unaggregated for a short window instead, exactly as the
// historian already does for dish telemetry (SAMPLE_WINDOW_SECONDS + the
// samples.json snapshot). Two tiers, same as the dish: full resolution recently,
// per-minute further back.
//
// In memory plus a periodic snapshot, not an append log: the window is small,
// every sample expires within the hour, and a torn tail costs at most a restart's
// worth of detail.

import { existsSync, readFileSync } from "node:fs";
import { ensureParentDirectory, writeJsonAtomically } from "./jsonLinesFile.mts";
import type { ClientReading } from "./clientStore.mts";

export interface ClientSample {
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

export class ClientWindow {
  private byMac = new Map<string, ClientSample[]>();

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
      const series = this.byMac.get(sample.macAddress) ?? [];
      series.push(sample);
      this.byMac.set(sample.macAddress, series);
    }
    for (const series of this.byMac.values()) series.sort((a, b) => a.atMs - b.atMs);
  }

  /** Record one poll's readings and drop whatever has aged out. */
  ingest(readings: ClientReading[], nowMs: number): void {
    const cutoffMs = nowMs - WINDOW_MS;
    for (const reading of readings) {
      const series = this.byMac.get(reading.macAddress) ?? [];
      series.push({
        macAddress: reading.macAddress,
        atMs: nowMs,
        downMbps: round(reading.downMbps),
        upMbps: round(reading.upMbps),
      });
      // Samples arrive in time order, so the expired ones are always a prefix.
      let firstLive = 0;
      while (firstLive < series.length && series[firstLive].atMs < cutoffMs) firstLive++;
      this.byMac.set(reading.macAddress, firstLive > 0 ? series.slice(firstLive) : series);
    }
    // A device that has gone away stops being written to, so its series would
    // otherwise sit at full length forever.
    for (const [macAddress, series] of this.byMac) {
      if (series.length > 0 && series[series.length - 1].atMs < cutoffMs) this.byMac.delete(macAddress);
    }
  }

  /**
   * Samples oldest first; all devices when `macAddress` is absent.
   *
   * `sinceMs` returns only what is newer, so a caller polling every second asks
   * for the whole window once and then a handful of samples per request instead
   * of re-sending thirty minutes of history each time.
   */
  samples(macAddress?: string, sinceMs?: number): ClientSample[] {
    const cutoffMs = Math.max(Date.now() - WINDOW_MS, sinceMs ?? 0);
    const series = macAddress
      ? (this.byMac.get(macAddress) ?? [])
      : [...this.byMac.values()].flat().sort((a, b) => a.atMs - b.atMs);
    return series.filter((sample) => sample.atMs > cutoffMs);
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
