// Hourly snapshots of the obstruction map for the time-lapse scrubber.
// Each cell is quantized to 2 bits (unmapped / clear / partial / obstructed),
// packed 4 cells per byte and base64'd: ~4 KB per snapshot, capped at 48
// snapshots (~2 days) in localStorage.

import type { DishObstructionMapJson } from "./dishClient";

const SNAPSHOT_STORAGE_KEY = "dishboard-obstruction-snapshots";
const SNAPSHOT_INTERVAL_MS = 3_600_000;
const MAX_SNAPSHOTS = 48;

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

export function quantizeCell(fractionUsable: number): number {
  if (fractionUsable < 0) return CELL_UNMAPPED;
  const obstructedFraction = 1 - fractionUsable;
  if (obstructedFraction <= OBSTRUCTED_FRACTION_FLOOR) return CELL_CLEAR;
  if (obstructedFraction <= PARTIAL_FRACTION_CEILING) return CELL_PARTIAL;
  return CELL_OBSTRUCTED;
}

function packCells(grid: number[]): string {
  const packed = new Uint8Array(Math.ceil(grid.length / 4));
  grid.forEach((fractionUsable, cellIndex) => {
    packed[cellIndex >> 2] |= quantizeCell(fractionUsable) << ((cellIndex & 3) * 2);
  });
  let binaryString = "";
  for (const byte of packed) binaryString += String.fromCharCode(byte);
  return btoa(binaryString);
}

export function unpackCells(snapshot: ObstructionSnapshot): Uint8Array {
  const binaryString = atob(snapshot.packedCells);
  const cellCount = snapshot.gridSize * snapshot.gridSize;
  const cells = new Uint8Array(cellCount);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    cells[cellIndex] = (binaryString.charCodeAt(cellIndex >> 2) >> ((cellIndex & 3) * 2)) & 3;
  }
  return cells;
}

export function listSnapshots(): ObstructionSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) ?? "[]") as ObstructionSnapshot[];
  } catch {
    return [];
  }
}

/** Persist a snapshot if the newest stored one is over an hour old. */
export function saveSnapshotIfDue(obstructionMap: DishObstructionMapJson): ObstructionSnapshot[] {
  const grid = obstructionMap.snr;
  if (!grid || grid.length === 0) return listSnapshots();
  const snapshots = listSnapshots();
  const newestTakenAt = snapshots.length > 0 ? snapshots[snapshots.length - 1].takenAtMs : 0;
  if (Date.now() - newestTakenAt < SNAPSHOT_INTERVAL_MS) return snapshots;

  snapshots.push({
    takenAtMs: Date.now(),
    gridSize: obstructionMap.numRows ?? Math.round(Math.sqrt(grid.length)),
    packedCells: packCells(grid),
    // Recorded per snapshot: the scrubber must re-project old grids at the
    // angle they were captured at, not whatever the dish reports today.
    maxThetaDeg: obstructionMap.maxThetaDeg,
  });
  const capped = snapshots.slice(-MAX_SNAPSHOTS);
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // storage full — time-lapse simply won't grow
  }
  return capped;
}
