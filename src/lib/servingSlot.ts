// Starlink reassigns terminals on 15-second boundaries against a clock every
// terminal shares, so the serving guess is made when the slot turns over and
// held until the next, rather than re-picked on every sample.

import { SERVING_ELEVATION_FLOOR_DEG, type SatelliteSky } from "./satellites";

export const HANDOFF_SLOT_MS = 15_000;

/** Counted from the epoch, so observers on the same clock agree on boundaries. */
export function slotIndexAt(nowMs: number): number {
  return Math.floor(nowMs / HANDOFF_SLOT_MS);
}

export interface ServingHold {
  slotIndex: number;
  name: string;
}

export interface ServingChoice {
  candidate: SatelliteSky | null;
  hold: ServingHold | null;
}

function bestAvailable(
  inView: SatelliteSky[],
  isUnobstructed: (sky: SatelliteSky) => boolean,
): SatelliteSky | null {
  // Sorted by elevation, so the first clear one is the highest.
  for (const sky of inView) {
    if (sky.elevationDeg < SERVING_ELEVATION_FLOOR_DEG) break;
    if (isUnobstructed(sky)) return sky;
  }
  const highest = inView[0];
  return highest && highest.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG ? highest : null;
}

export function chooseServingCandidate(
  inView: SatelliteSky[],
  nowMs: number,
  hold: ServingHold | null,
  isUnobstructed: (sky: SatelliteSky) => boolean,
): ServingChoice {
  const slotIndex = slotIndexAt(nowMs);

  if (hold && hold.slotIndex === slotIndex) {
    const held = inView.find((sky) => sky.name === hold.name);
    if (held && held.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG && isUnobstructed(held)) {
      return { candidate: held, hold };
    }
  }

  // A replacement inherits the slot in progress: losing a satellite does not
  // restart the dish's clock.
  const candidate = bestAvailable(inView, isUnobstructed);
  return { candidate, hold: candidate ? { slotIndex, name: candidate.name } : null };
}
