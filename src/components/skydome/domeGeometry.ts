// The dome's coordinate math, kept apart from the canvas that draws it.
//
// Everything here is pure: sky angles in, unit-sphere points out. That makes it
// the one part of the sky view that can be checked without a canvas, which is
// why it is separated — the drawing routine itself is one coupled frame and
// stays whole.

import {
  CELL_CLEAR,
  CELL_PARTIAL,
  CELL_UNMAPPED,
  OBSTRUCTED_FRACTION_FLOOR,
  PARTIAL_FRACTION_CEILING,
} from "../../lib/obstructionSnapshots";

export type DomePointKind = "clear" | "partial" | "obstructed" | "unmapped";

export interface DomePoint {
  x: number; // east
  y: number; // north
  z: number; // up
  kind: DomePointKind;
}

export interface TrailPoint {
  azimuthDeg: number;
  elevationDeg: number;
  atMs: number;
}

export const STANDARD_CANVAS_SIZE = 330;
export const IMMERSIVE_CANVAS_SIZE = 540;
export const GRID_STRIDE = 2;
export const INITIAL_YAW = 0.6;
export const INITIAL_ELEVATION = 0.62;
export const TRAIL_POINT_INTERVAL_MS = 1_000;
export const TRAIL_MAX_POINTS = 24;
/** One turn every two minutes: present when you look at it, never the thing
 *  moving in the corner of your eye. Dashboard dome only — the immersive view is
 *  the one you aim and inspect with, so it stays where you put it. */
export const AUTO_ROTATE_RAD_PER_SEC = (2 * Math.PI) / 120;
/** Rotation yields after a drag, so it isn't fighting the angle you just set. */
export const RESUME_AFTER_DRAG_MS = 4_000;
/** ~25fps: enough for a motion this slow, a quarter of the frames of 60. */
export const AUTO_ROTATE_FRAME_MS = 40;

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Azimuth/elevation in degrees → a point on the unit sphere (east, north, up). */
export function skyToWorld(
  azimuthDeg: number,
  elevationDeg: number,
): { x: number; y: number; z: number } {
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const elevationRad = (elevationDeg * Math.PI) / 180;
  return {
    x: Math.cos(elevationRad) * Math.sin(azimuthRad),
    y: Math.cos(elevationRad) * Math.cos(azimuthRad),
    z: Math.sin(elevationRad),
  };
}

/**
 * Lifts the dish's square obstruction grid onto the hemisphere. The grid is a
 * polar plot: distance from its centre is the zenith angle (out to
 * `maxThetaDeg`), so cells beyond the inscribed circle are outside the dish's
 * field of view and are dropped.
 */
export function buildDomePoints(
  gridSize: number,
  maxThetaDeg: number,
  kindAtCell: (rowIndex: number, columnIndex: number) => DomePointKind | null,
): DomePoint[] {
  const maxThetaRad = (maxThetaDeg * Math.PI) / 180;
  const gridCenter = (gridSize - 1) / 2;
  const points: DomePoint[] = [];
  for (let rowIndex = 0; rowIndex < gridSize; rowIndex += GRID_STRIDE) {
    for (let columnIndex = 0; columnIndex < gridSize; columnIndex += GRID_STRIDE) {
      const eastOffset = (columnIndex - gridCenter) / gridCenter;
      const northOffset = (gridCenter - rowIndex) / gridCenter;
      const radialFraction = Math.hypot(eastOffset, northOffset);
      if (radialFraction > 1) continue;
      const kind = kindAtCell(rowIndex, columnIndex);
      if (kind === null) continue;
      const zenithAngle = radialFraction * maxThetaRad;
      const horizontalScale = radialFraction === 0 ? 0 : Math.sin(zenithAngle) / radialFraction;
      points.push({
        x: eastOffset * horizontalScale,
        y: northOffset * horizontalScale,
        z: Math.cos(zenithAngle),
        kind,
      });
    }
  }
  return points;
}

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
