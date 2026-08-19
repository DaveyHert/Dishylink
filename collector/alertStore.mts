// Durable log of every alert episode, from both the dish and the router.
//
// Both devices report alerts as live booleans and keep no history: once a flag
// clears, the episode is gone. Water detected at 3am that dried by breakfast
// left no trace anywhere. core/alertEngine spots the false→true and true→false
// edges and this writes them down, so the notification panel can show what
// happened while nobody was looking.
//
// It records transitions, it does not find them. Every host runs the same engine
// over the same readings, so a store that decided for itself when an episode
// began would be a second opinion — and the two would disagree, as this one and
// the browser already did about the dish's latched noEthernetLink flag.
//
// Deliberately key-agnostic: whatever boolean the firmware sends gets recorded,
// so an alert added by a future firmware is captured without a code change. The
// UI maps keys to human wording (core/alertDefinitions.ts); unknown keys still
// surface rather than being silently dropped.
//
// Episodes are few and small (a healthy setup produces none for weeks) and an
// open one must be closed later, so the whole log stays in memory and is
// rewritten on change — same shape as thermalStore, which this generalises.

import {
  ensureParentDirectory,
  readJsonLines,
  writeJsonLinesAtomically,
} from "./jsonLinesFile.mts";
import type { AlertSeverity } from "../core/alertDefinitions.ts";

/** The two devices, plus "system" for conditions the historian observes about
 *  them rather than reads off them — chiefly a device not answering at all,
 *  which by definition can never appear in that device's own alert payload. */
export type AlertSource = "dish" | "router" | "system";

export interface AlertEpisode {
  /** Which device raised it — both use overlapping keys (e.g. thermalThrottle). */
  source: AlertSource;
  /** The raw `alerts` key, e.g. "dishWaterDetected". */
  key: string;
  startMs: number;
  /** null while the flag is still set. */
  endMs: number | null;
  /** What was announced. Absent where the wording is a constant the UI looks up. */
  label?: string;
  severity?: AlertSeverity;
}

// 48 hours, one window shared with the event and thermal logs it sits beside,
// so "has this dish been flagging water ingress / thermal trouble lately?" reads
// over the same span everywhere.
const RETENTION_MS = 48 * 3_600_000;

export class AlertStore {
  private episodes: AlertEpisode[] = [];

  constructor(private readonly filePath: string) {
    ensureParentDirectory(filePath);
    this.episodes = readJsonLines<AlertEpisode>(filePath);
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    // An open episode is current state, not history — keep it however long it runs.
    this.episodes = this.episodes.filter(
      (episode) => episode.endMs === null || episode.startMs >= cutoffMs,
    );
    writeJsonLinesAtomically(this.filePath, this.episodes);
  }

  /**
   * Episodes newest-first, for the API. Cutoff applied here as well as in flush,
   * which only runs when an episode opens or closes — a quiet stretch (the usual
   * case: a healthy dish raises nothing for weeks) or a restart would otherwise
   * serve episodes past the window. An open episode is kept regardless of age,
   * for the same reason flush keeps it: it is current state, not history.
   */
  all(): AlertEpisode[] {
    const cutoffMs = Date.now() - RETENTION_MS;
    return [...this.episodes]
      .filter((episode) => episode.endMs === null || episode.startMs >= cutoffMs)
      .sort((a, b) => b.startMs - a.startMs);
  }

  isOpen(source: AlertSource, key: string): boolean {
    return this.episodes.some(
      (episode) => episode.source === source && episode.key === key && episode.endMs === null,
    );
  }

  open(
    source: AlertSource,
    key: string,
    startMs: number,
    announced?: { label: string; severity: AlertSeverity },
  ): void {
    if (this.isOpen(source, key)) return;
    this.episodes.push({ source, key, startMs, endMs: null, ...announced });
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
}
