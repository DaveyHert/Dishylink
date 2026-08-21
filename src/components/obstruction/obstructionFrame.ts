// How the dish's obstruction grid maps onto geographic east/north.
//
// The firmware labels the grid with `mapReferenceFrame`:
//
//   FRAME_EARTH — top-center is true north (what a Standard on a fixed site
//                 reports). This is the convention the dome already drew.
//   FRAME_UT    — bottom-center is the user-terminal boresight azimuth. Mini
//                 kits on roam/mobile typically report this. Treating that
//                 grid as earth-north puts the used sky on the south rim —
//                 the opposite of the official Starlink app.
//
// When the field is missing, Mini hardware is assumed FRAME_UT and everything
// else FRAME_EARTH, matching the kits that actually emit each frame.

import type { DishModel } from "../../lib/dishMesh";
import type { ObstructionMapReferenceFrame } from "@core/dishClient";

export type ObstructionMapFrame = "FRAME_EARTH" | "FRAME_UT";

export function resolveObstructionFrame(
  reported: ObstructionMapReferenceFrame | string | undefined,
  dishModel: DishModel,
): ObstructionMapFrame {
  if (reported === "FRAME_EARTH" || reported === "FRAME_UT") return reported;
  return dishModel === "mini1" || dishModel === "mini2" ? "FRAME_UT" : "FRAME_EARTH";
}

/** Grid cell → local east/north in units of grid radius (−1…1). */
export function gridCellToEnu(
  row: number,
  col: number,
  gridSize: number,
  frame: ObstructionMapFrame,
  boresightAzimuthDeg: number,
): { east: number; north: number } {
  const centre = (gridSize - 1) / 2;
  const eastGrid = (col - centre) / centre;
  const northGrid = (centre - row) / centre;
  if (frame !== "FRAME_UT") return { east: eastGrid, north: northGrid };

  // After a vertical flip, +forward is the bottom of the page (boresight) and
  // +right is still +column. Rotate that body frame by the boresight azimuth
  // so forward lands on the real compass bearing.
  const forward = -northGrid;
  const right = eastGrid;
  const azimuthRad = (boresightAzimuthDeg * Math.PI) / 180;
  const sine = Math.sin(azimuthRad);
  const cosine = Math.cos(azimuthRad);
  return {
    east: right * cosine + forward * sine,
    north: -right * sine + forward * cosine,
  };
}

/** Geographic az/el (as a polar fraction from zenith) → the grid cell that holds it. */
export function skyDirectionToGrid(
  azimuthDeg: number,
  radialFraction: number,
  gridSize: number,
  frame: ObstructionMapFrame,
  boresightAzimuthDeg: number,
): { row: number; col: number } {
  const centre = (gridSize - 1) / 2;
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const east = Math.sin(azimuthRad) * radialFraction;
  const north = Math.cos(azimuthRad) * radialFraction;
  if (frame !== "FRAME_UT") {
    return {
      row: Math.round(centre - north * centre),
      col: Math.round(centre + east * centre),
    };
  }

  const boresightRad = (boresightAzimuthDeg * Math.PI) / 180;
  const sine = Math.sin(boresightRad);
  const cosine = Math.cos(boresightRad);
  const right = east * cosine - north * sine;
  const forward = east * sine + north * cosine;
  return {
    row: Math.round(centre + forward * centre),
    col: Math.round(centre + right * centre),
  };
}
