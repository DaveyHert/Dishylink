// Durable log of the dish's own outage/event entries.
//
// The dish keeps these in a bounded list that rolls, and clears it outright on
// reboot — so an outage from last week is gone whether or not anyone saw it.
// The collector already polls the history this list rides on, so recording it
// costs nothing extra and is the only way the event log reaches past whatever
// the dish still happens to remember.
//
// Events are few, and an in-progress outage's duration grows across polls, so
// this keeps the whole log in memory and rewrites the file on change rather
// than appending. Anything older than the retention window is dropped on write.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StoredEvent {
  startMs: number;
  durationMs: number;
  cause: string;
  severity: "advisory" | "warning" | "critical";
}

const RETENTION_MS = 30 * 24 * 3_600_000;

/** Same outage seen again across polls: the dish restates it with a longer duration. */
function keyOf(event: StoredEvent): string {
  return `${event.startMs}:${event.cause}`;
}

export class EventStore {
  private events = new Map<string, StoredEvent>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    for (const event of this.readFile()) this.events.set(keyOf(event), event);
  }

  private readFile(): StoredEvent[] {
    if (!existsSync(this.filePath)) return [];
    const events: StoredEvent[] = [];
    for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        // skip a torn final line from a crash mid-write
      }
    }
    return events;
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    for (const [key, event] of this.events) {
      if (event.startMs < cutoffMs) this.events.delete(key);
    }
    const body = [...this.events.values()]
      .sort((a, b) => a.startMs - b.startMs)
      .map((event) => JSON.stringify(event))
      .join("\n");
    // temp + rename so a crash mid-write never tears the log
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, body ? body + "\n" : "");
    renameSync(tempPath, this.filePath);
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

  /** Events newest-first, for the API. */
  all(): StoredEvent[] {
    return [...this.events.values()].sort((a, b) => b.startMs - a.startMs);
  }
}
