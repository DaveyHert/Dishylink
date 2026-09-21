// Durable log of auto-generated outage post-mortem reports.
//
// One line per ended outage, written the moment the recorder sees the outage
// end. Reports are few (a healthy setup produces none for weeks), so this keeps
// the whole log in memory and rewrites the file on change — same shape as
// eventStore, whose 48-hour window this intentionally outlives: a report is a
// self-contained, shareable artifact, so it stays reachable (and copyable) long
// after the events panel has rolled past the outage that produced it.

import {
  ensureParentDirectory,
  readJsonLines,
  writeJsonLinesAtomically,
} from "./jsonLinesFile.mts";
import type { OutageReport } from "../core/postmortem.ts";

// 30 days. Self-contained and small, so a month costs a handful of rows; the
// events panel beside it is 48 h, which is why the report lives longer.
const RETENTION_MS = 30 * 24 * 3_600_000;

export class PostmortemStore {
  private reports = new Map<string, OutageReport>();

  constructor(private readonly filePath: string) {
    ensureParentDirectory(filePath);
    for (const report of readJsonLines<OutageReport>(filePath)) {
      this.reports.set(report.id, report);
    }
  }

  private flush(): void {
    const cutoffMs = Date.now() - RETENTION_MS;
    for (const [id, report] of this.reports) {
      if (report.endMs < cutoffMs) this.reports.delete(id);
    }
    // Oldest first on disk, so the log reads chronologically.
    const ordered = [...this.reports.values()].sort((a, b) => a.endMs - b.endMs);
    writeJsonLinesAtomically(this.filePath, ordered);
  }

  /**
   * Persist a report. Returns whether it was new; an episode can only close
   * once, so a second add for the same id is a regeneration bug, not an update —
   * the first frozen report stands.
   */
  add(report: OutageReport): boolean {
    if (this.reports.has(report.id)) return false;
    this.reports.set(report.id, report);
    this.flush();
    return true;
  }

  /**
   * Reports newest-first, for the API. The retention cutoff is applied here as
   * well as in flush — flush only runs when a report is added, so a quiet
   * stretch (the usual case) would otherwise serve rows past the window.
   */
  all(): OutageReport[] {
    const cutoffMs = Date.now() - RETENTION_MS;
    return [...this.reports.values()]
      .filter((report) => report.endMs >= cutoffMs)
      .sort((a, b) => b.endMs - a.endMs);
  }
}
