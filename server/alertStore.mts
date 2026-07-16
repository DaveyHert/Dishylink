// Durable log of every alert episode, from both the dish and the router.
//
// Both devices report alerts as live booleans and keep no history: once a flag
// clears, the episode is gone. Water detected at 3am that dried by breakfast
// left no trace anywhere. The collector watches the false→true and true→false
// edges on every key and records them here, so the notification panel can show
// what happened while nobody was looking.
//
// Deliberately key-agnostic: whatever boolean the firmware sends gets recorded,
// so an alert added by a future firmware is captured without a code change. The
// UI maps keys to human wording (src/lib/dishAlerts.ts); unknown keys still
// surface rather than being silently dropped.
//
// Episodes are few and small (a healthy setup produces none for weeks) and an
// open one must be closed later, so the whole log stays in memory and is
// rewritten on change — same shape as thermalStore, which this generalises.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type AlertSource = "dish" | "router";

export interface AlertEpisode {
  /** Which device raised it — both use overlapping keys (e.g. thermalThrottle). */
  source: AlertSource;
  /** The raw `alerts` key, e.g. "dishWaterDetected". */
  key: string;
  startMs: number;
  /** null while the flag is still set. */
  endMs: number | null;
}

const RETENTION_MS = 30 * 24 * 3_600_000;

export class AlertStore {
  private episodes: AlertEpisode[] = [];

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.episodes = this.readFile();
  }

  private readFile(): AlertEpisode[] {
    if (!existsSync(this.filePath)) return [];
    const episodes: AlertEpisode[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        episodes.push(JSON.parse(line) as AlertEpisode);
      } catch {
        // skip a torn final line from a crash mid-write
      }
    }
    return episodes;
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    // An open episode is current state, not history — keep it however long it runs.
    this.episodes = this.episodes.filter(
      (episode) => episode.endMs === null || episode.startMs >= cutoffMs,
    );
    const body = this.episodes.map((episode) => JSON.stringify(episode)).join("\n");
    // temp + rename so a crash mid-write never tears the log
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
  }

  /** Episodes newest-first, for the API. */
  all(): AlertEpisode[] {
    return [...this.episodes].sort((a, b) => b.startMs - a.startMs);
  }

  isOpen(source: AlertSource, key: string): boolean {
    return this.episodes.some(
      (episode) => episode.source === source && episode.key === key && episode.endMs === null,
    );
  }

  open(source: AlertSource, key: string, startMs: number): void {
    if (this.isOpen(source, key)) return;
    this.episodes.push({ source, key, startMs, endMs: null });
    this.flush();
  }

  close(source: AlertSource, key: string, endMs: number): void {
    if (!this.isOpen(source, key)) return;
    for (const episode of this.episodes) {
      if (episode.source === source && episode.key === key && episode.endMs === null) {
        episode.endMs = endMs;
      }
    }
    this.flush();
  }

  /**
   * Reconcile one device's live alert booleans against the log: open episodes
   * for newly-set flags, close ones that cleared. `alerts` omits false keys
   * (proto3), so anything open and absent has cleared.
   */
  ingest(source: AlertSource, alerts: Record<string, boolean>, nowMs: number): void {
    for (const [key, isActive] of Object.entries(alerts)) {
      if (isActive === true) this.open(source, key, nowMs);
      else this.close(source, key, nowMs);
    }
    // Keys that vanished entirely from the payload have also cleared.
    for (const episode of this.all()) {
      if (episode.source !== source || episode.endMs !== null) continue;
      if (!(episode.key in alerts)) this.close(source, episode.key, nowMs);
    }
  }
}
