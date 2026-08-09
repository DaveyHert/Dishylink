// The desktop odometer: the shared core with an on-disk snapshot behind it.
//
// All the accounting — reset-aware deltas, clientId keying, monthly buckets,
// re-anchoring across a factory reset — lives in ClientTotalsCore, shared with
// the extension's IndexedDB-backed recorder. This adds only the fs persistence:
// restore the snapshot at startup, write it back on snapshot(). The default
// MAX_GAP window (a ~1 Hz recorder's ceiling) is right for the historian's poll.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ClientTotalsCore,
  VERSION,
  type ClientTotal,
  type Snapshot,
} from "../core/clientTotals.ts";

export type { ClientTotal };

export class ClientTotalsStore extends ClientTotalsCore {
  constructor(private readonly filePath: string) {
    super();
    mkdirSync(dirname(filePath), { recursive: true });
    this.restore();
  }

  private restore(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const persisted = JSON.parse(readFileSync(this.filePath, "utf8")) as Snapshot;
      // Anything else is a shape this build does not know how to read; starting
      // fresh beats loading it wrong. Buckets with no clientId are normal here —
      // a device that has not been seen since it was keyed by MAC adopts its
      // clientId on the next poll (see adoptOrCreate).
      if (persisted?.version !== VERSION) return;
      this.loadSnapshot(persisted);
    } catch {
      // unreadable snapshot: start fresh rather than refuse to boot
    }
  }

  /** Persist so a restart resumes the running totals rather than seeding anew. */
  snapshot(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(this.toSnapshot()));
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed snapshot costs at most the interval's accumulation on a restart
    }
  }
}
