// Reading the historian's hourly obstruction snapshots for the time-lapse.
//
// Each cell is quantized to 2 bits (unmapped / clear / partial / obstructed) and
// packed 4 cells per byte, so a 123×123 grid rides in ~5 KB of base64. The
// packing half lives in the historian (collector/obstructionStore.mts), which is
// the only writer; this side only ever unpacks what it is served.

import { apiRequest } from "./apiHost";

export const CELL_UNMAPPED = 0;
export const CELL_CLEAR = 1;
export const CELL_PARTIAL = 2;
export const CELL_OBSTRUCTED = 3;

export interface ObstructionSnapshot {
  takenAtMs: number;
  gridSize: number;
  packedCells: string;
  /** Half-angle of the sky cone this grid covers. Absent on snapshots taken
   *  before it was recorded — those fall back to the live map's value. */
  maxThetaDeg?: number;
}

/** Anything blocked beyond this reads as obstructed rather than clear. */
export const OBSTRUCTED_FRACTION_FLOOR = 0.005;
/** Up to this much blockage is "partial" — a thin branch, not a roofline. */
export const PARTIAL_FRACTION_CEILING = 0.25;

export function unpackCells(snapshot: ObstructionSnapshot): Uint8Array {
  const binaryString = atob(snapshot.packedCells);
  const cellCount = snapshot.gridSize * snapshot.gridSize;
  const cells = new Uint8Array(cellCount);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    cells[cellIndex] = (binaryString.charCodeAt(cellIndex >> 2) >> ((cellIndex & 3) * 2)) & 3;
  }
  return cells;
}

/**
 * Read the recorded history. Returns null — distinct from an empty list — when
 * the historian cannot be reached, so a caller can tell "nothing recorded yet"
 * apart from "recorder is down" and hold on to what it already has.
 */
export async function fetchSnapshots(): Promise<ObstructionSnapshot[] | null> {
  try {
    const response = await apiRequest("/api/obstruction/snapshots", {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { snapshots?: ObstructionSnapshot[] };
    return body.snapshots ?? [];
  } catch {
    return null;
  }
}
