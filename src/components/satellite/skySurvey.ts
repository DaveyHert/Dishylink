// Turning what the dish reports into what the scene draws.
//
// Shared by both surfaces that render a dome — the dashboard's obstruction card
// and the full sky view — because they read the same grid the same way and must
// not drift into two answers about which cell is obstructed or which kit this is.

import type { DishObstructionMapJson, DishStatusJson } from "../../lib/dishClient";
import { resolveDishModel, type DishModel } from "../../lib/dishMesh";
import { unpackCells, type ObstructionSnapshot } from "../../lib/obstructionSnapshots";
import { liveKindAtCell, snapshotKindAtCell } from "../obstruction/obstructionGrid";
import type { SkySurvey } from "./skyGeometry";

const KIND_CODE = { unmapped: 0, clear: 1, partial: 2, obstructed: 3 } as const;

/** The kit to draw, from the same status reply the boresight comes from. Uses
 *  the shared resolver, so this agrees with the alignment card by construction. */
export function dishModelFor(status: DishStatusJson | null): DishModel {
  return resolveDishModel(
    status?.deviceInfo?.hardwareVersion,
    status?.hasActuators === "HAS_ACTUATORS_YES",
  );
}

/** The live grid, flattened to the one byte per cell the scene wants. */
export function liveSurvey(
  map: DishObstructionMapJson | null,
  status: DishStatusJson | null,
): SkySurvey | null {
  const gridSize = map?.numRows ?? 0;
  if (!map?.snr || !gridSize || map.numCols !== gridSize) return null;
  const kindAt = liveKindAtCell(map.snr, gridSize);
  const kinds = new Uint8Array(gridSize * gridSize);
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      kinds[row * gridSize + col] = KIND_CODE[kindAt(row, col)];
    }
  }
  return {
    gridSize,
    maxThetaDeg: map.maxThetaDeg ?? 80,
    kinds,
    boresightAzimuthDeg: status?.boresightAzimuthDeg ?? 0,
    boresightElevationDeg: status?.boresightElevationDeg ?? 90,
    dishModel: dishModelFor(status),
  };
}

/** A stored snapshot, which already holds bucketed kinds rather than fractions. */
export function snapshotSurvey(
  snapshot: ObstructionSnapshot,
  fallbackMaxTheta: number,
  status: DishStatusJson | null,
): SkySurvey {
  const gridSize = snapshot.gridSize;
  const kindAt = snapshotKindAtCell(unpackCells(snapshot), gridSize);
  const kinds = new Uint8Array(gridSize * gridSize);
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      kinds[row * gridSize + col] = KIND_CODE[kindAt(row, col)];
    }
  }
  return {
    gridSize,
    maxThetaDeg: snapshot.maxThetaDeg ?? fallbackMaxTheta,
    kinds,
    boresightAzimuthDeg: status?.boresightAzimuthDeg ?? 0,
    boresightElevationDeg: status?.boresightElevationDeg ?? 90,
    dishModel: dishModelFor(status),
  };
}
