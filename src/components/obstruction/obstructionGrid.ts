// How the dish's obstruction grid is read.
//
// The grid is a polar plot: one cell per direction, distance from its centre
// being the zenith angle. All that is left here is the classification — a cell
// in, one of four kinds out — which both domes share so they can never disagree
// about what counts as obstructed. Lifting cells onto the hemisphere belongs to
// the renderer, in satellite/skyGeometry.

import {
  CELL_CLEAR,
  CELL_PARTIAL,
  CELL_UNMAPPED,
  OBSTRUCTED_FRACTION_FLOOR,
  PARTIAL_FRACTION_CEILING,
} from "../../lib/obstructionSnapshots";

export type DomePointKind = "clear" | "partial" | "obstructed" | "unmapped";

/** Cell classifier over the dish's live map, where a cell is the usable fraction
 *  (negative meaning never observed). */
export function liveKindAtCell(grid: number[], gridSize: number) {
  return (rowIndex: number, columnIndex: number): DomePointKind => {
    const fractionUsable = grid[rowIndex * gridSize + columnIndex];
    if (fractionUsable < 0) return "unmapped";
    const obstructedFraction = 1 - fractionUsable;
    if (obstructedFraction <= OBSTRUCTED_FRACTION_FLOOR) return "clear";
    return obstructedFraction <= PARTIAL_FRACTION_CEILING ? "partial" : "obstructed";
  };
}

/** Cell classifier over a stored snapshot, which already holds bucketed kinds. */
export function snapshotKindAtCell(cells: Uint8Array, gridSize: number) {
  return (rowIndex: number, columnIndex: number): DomePointKind => {
    const cellKind = cells[rowIndex * gridSize + columnIndex];
    if (cellKind === CELL_UNMAPPED) return "unmapped";
    if (cellKind === CELL_CLEAR) return "clear";
    return cellKind === CELL_PARTIAL ? "partial" : "obstructed";
  };
}
