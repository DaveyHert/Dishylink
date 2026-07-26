// Durable hourly snapshots of the dish's obstruction map, for the time-lapse.
//
// These used to live in the browser's localStorage, written by the dashboard's
// dome as new maps arrived. That had three problems the historian does not:
//
//   - it only recorded while a tab was open, so a day with the app closed left
//     a hole in the history;
//   - localStorage is per-browser and per-origin, so Chrome, Firefox and Safari
//     each accumulated a separate, disagreeing history;
//   - quota pressure capped it at 48 entries (~2 days).
//
// The historian already runs as a service and writes to disk, so it can record
// on its own clock and keep a longer window. Cells are stored in the same packed
// 2-bits-per-cell base64 the browser used, so the client's `unpackCells` and the
// snapshot rendering path are unchanged.

import {
  ensureParentDirectory,
  readJsonLines,
  writeJsonLinesAtomically,
} from "./jsonLinesFile.mts";

export interface ObstructionSnapshot {
  takenAtMs: number;
  gridSize: number;
  /** base64 of 2 bits per cell: 0 unmapped, 1 clear, 2 partial, 3 obstructed. */
  packedCells: string;
  /** Half-angle of the sky cone this grid covers. */
  maxThetaDeg?: number;
}

/** One snapshot an hour, matching what the browser used to record. */
export const SNAPSHOT_INTERVAL_MS = 3_600_000;

/**
 * A week, where localStorage managed two days. Each snapshot is a 123×123 grid
 * at 2 bits per cell — about 5 kB of base64 — so a week is well under a megabyte.
 */
const RETENTION_MS = 7 * 24 * 3_600_000;

// Thresholds duplicated from the client's obstructionSnapshots.ts. They have to
// agree, because a snapshot written here is rendered by that code.
const OBSTRUCTED_FRACTION_FLOOR = 0.005;
const PARTIAL_FRACTION_CEILING = 0.25;

const CELL_UNMAPPED = 0;
const CELL_CLEAR = 1;
const CELL_PARTIAL = 2;
const CELL_OBSTRUCTED = 3;

function quantizeCell(fractionUsable: number): number {
  if (fractionUsable < 0) return CELL_UNMAPPED;
  const obstructed = 1 - fractionUsable;
  if (obstructed <= OBSTRUCTED_FRACTION_FLOOR) return CELL_CLEAR;
  return obstructed <= PARTIAL_FRACTION_CEILING ? CELL_PARTIAL : CELL_OBSTRUCTED;
}

export function packCells(grid: number[]): string {
  const packed = new Uint8Array(Math.ceil(grid.length / 4));
  grid.forEach((fractionUsable, index) => {
    packed[index >> 2] |= quantizeCell(fractionUsable) << ((index & 3) * 2);
  });
  return Buffer.from(packed).toString("base64");
}

export class ObstructionStore {
  private snapshots: ObstructionSnapshot[] = [];

  constructor(private readonly filePath: string) {
    ensureParentDirectory(filePath);
    // A snapshot without a grid or its packed cells cannot be rendered, so it is
    // dropped on read rather than handed to the scrubber as a hole.
    this.snapshots = readJsonLines<ObstructionSnapshot>(
      filePath,
      (snapshot) => snapshot.gridSize > 0 && typeof snapshot.packedCells === "string",
    );
  }

  /** Newest last, which is the order the scrubber expects. */
  list(): ObstructionSnapshot[] {
    return this.snapshots;
  }

  /** Is the newest snapshot old enough that another is due? */
  isDue(now: number): boolean {
    const newest = this.snapshots[this.snapshots.length - 1];
    return !newest || now - newest.takenAtMs >= SNAPSHOT_INTERVAL_MS;
  }

  /** Append one and drop anything past the retention window. */
  record(snapshot: ObstructionSnapshot): ObstructionSnapshot[] {
    const cutoff = snapshot.takenAtMs - RETENTION_MS;
    this.snapshots = [...this.snapshots, snapshot].filter((s) => s.takenAtMs >= cutoff);
    writeJsonLinesAtomically(this.filePath, this.snapshots);
    return this.snapshots;
  }
}
