// Durable log of dish thermal episodes.
//
// The dish reports thermal state as live booleans on get_status → alerts and
// keeps no history of its own: once a flag clears, the episode is gone. The
// historian watches the false→true edges and records them here, so an episode
// that happened overnight is still there in the morning — with no browser open.
//
// Episodes are few and small (a healthy dish produces none for weeks), and an
// open episode has to be closed once it clears, so this keeps the whole log in
// memory and rewrites the file on change rather than doing append-only with
// compaction. Anything older than the retention window is dropped on write.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ThermalEpisode {
  /** `alerts` key that produced this, e.g. "thermalThrottle". */
  alertKey: string;
  startMs: number;
  /** null while the flag is still set. */
  endMs: number | null;
}

// 24 hours, matching the event store: both feed the same "Events & outages"
// panel, and a panel that is a day deep for outages and a month deep for
// throttles is worse than either window chosen on its own.
const RETENTION_MS = 24 * 3_600_000;

export class ThermalStore {
  private episodes: ThermalEpisode[] = [];

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.episodes = this.readFile();
  }

  private readFile(): ThermalEpisode[] {
    if (!existsSync(this.filePath)) return [];
    const episodes: ThermalEpisode[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        episodes.push(JSON.parse(line) as ThermalEpisode);
      } catch {
        // skip a torn final line from a crash mid-write
      }
    }
    return episodes;
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    // Keep an episode that is still open regardless of age: an unresolved
    // throttle is current state, not history, however long it has run.
    this.episodes = this.episodes.filter(
      (episode) => episode.endMs === null || episode.startMs >= cutoffMs,
    );
    const body = this.episodes.map((episode) => JSON.stringify(episode)).join("\n");
    // temp + rename so a crash mid-write never tears the log
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
  }

  /**
   * Episodes newest-first, for the API. Cutoff applied here as well as in flush,
   * which only runs when an episode opens or closes — a quiet stretch or a
   * restart would otherwise serve episodes past the window. An open episode is
   * kept regardless of age, for the same reason flush keeps it: an unresolved
   * throttle is current state, not history.
   */
  all(): ThermalEpisode[] {
    const cutoffMs = Date.now() - RETENTION_MS;
    return [...this.episodes]
      .filter((episode) => episode.endMs === null || episode.startMs >= cutoffMs)
      .sort((a, b) => b.startMs - a.startMs);
  }

  isOpen(alertKey: string): boolean {
    return this.episodes.some((episode) => episode.alertKey === alertKey && episode.endMs === null);
  }

  open(alertKey: string, startMs: number): void {
    if (this.isOpen(alertKey)) return;
    this.episodes.push({ alertKey, startMs, endMs: null });
    this.flush();
  }

  close(alertKey: string, endMs: number): void {
    if (!this.isOpen(alertKey)) return;
    for (const episode of this.episodes) {
      if (episode.alertKey === alertKey && episode.endMs === null) episode.endMs = endMs;
    }
    this.flush();
  }
}
