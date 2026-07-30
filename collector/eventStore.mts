// Durable log of the dish's own outage/event entries.
//
// The dish keeps these in a bounded list that rolls, and clears it outright on
// reboot — so an outage from last week is gone whether or not anyone saw it.
// The historian already polls the history this list rides on, so recording it
// costs nothing extra and is the only way the event log reaches past whatever
// the dish still happens to remember.
//
// Events are few, and an in-progress outage's duration grows across polls, so
// this keeps the whole log in memory and rewrites the file on change rather
// than appending. Anything older than the retention window is dropped on write,
// and filtered again on read so the window holds even when nothing is being
// written.
//
// The window is deliberately short (a day). This log reaches past the dish's own
// rolling buffer so the panel survives a reboot and covers overnight — it is not
// an archive, and nothing in the UI reads events older than the 6H chart window.

import {
  ensureParentDirectory,
  readJsonLines,
  writeJsonLinesAtomically,
} from "./jsonLinesFile.mts";
import { canonicalCause } from "../core/telemetry.ts";

export interface StoredEvent {
  startMs: number;
  durationMs: number;
  cause: string;
  severity: "advisory" | "warning" | "critical";
}

// 48 hours. The event log is a "what happened recently" panel, not an archive;
// two days keeps it deep enough that a couple of nights back is still there
// while sharing one window with the alert and thermal logs beside it.
const RETENTION_MS = 48 * 3_600_000;

/** Same outage seen again across polls: the dish restates it with a longer
 *  duration. Keyed on the canonical cause token (not the raw/label spelling) so
 *  a row saved by an older build under a different label still folds into one. */
function keyOf(event: StoredEvent): string {
  return `${event.startMs}:${canonicalCause(event.cause)}`;
}

export class EventStore {
  private events = new Map<string, StoredEvent>();

  constructor(private readonly filePath: string) {
    ensureParentDirectory(filePath);
    for (const event of readJsonLines<StoredEvent>(filePath)) this.events.set(keyOf(event), event);
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    for (const [key, event] of this.events) {
      if (event.startMs < cutoffMs) this.events.delete(key);
    }
    // Oldest first on disk, so the log reads chronologically.
    const ordered = [...this.events.values()].sort((a, b) => a.startMs - b.startMs);
    writeJsonLinesAtomically(this.filePath, ordered);
  }

  /**
   * Fold in what the dish currently reports. Returns how many entries were new
   * or changed, so a quiet poll costs no disk write.
   */
  upsert(incoming: StoredEvent[]): number {
    let changed = 0;
    for (const event of incoming) {
      const existing = this.events.get(keyOf(event));
      // A known outage whose duration has grown is the same outage, still running.
      if (existing && existing.durationMs >= event.durationMs) continue;
      this.events.set(keyOf(event), event);
      changed++;
    }
    if (changed > 0) this.flush();
    return changed;
  }

  /**
   * Events newest-first, for the API. The retention cutoff is applied here, not
   * just in flush: flush only runs when a new event arrives, so a quiet stretch
   * — or a restart, which reloads the whole file — would otherwise serve rows
   * well past the window. Filtering on read makes it hold unconditionally.
   */
  all(): StoredEvent[] {
    const cutoffMs = Date.now() - RETENTION_MS;
    return [...this.events.values()]
      .filter((event) => event.startMs >= cutoffMs)
      .sort((a, b) => b.startMs - a.startMs);
  }
}
