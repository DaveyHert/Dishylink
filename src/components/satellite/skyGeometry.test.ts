import { describe, expect, it } from "vitest";
import { buildDomePoints, observedEnvelope } from "./skyGeometry";
import type { SkySurvey } from "./skyGeometry";

/** A grid where every cell inside `readTo` (in grid radius) is a clear reading
 *  and everything beyond it has never been observed — the shape a real dish
 *  makes, a cap of readings inside a shell of unmapped sky. */
function survey(gridSize: number, readTo: number, overrides: Partial<SkySurvey> = {}): SkySurvey {
  const centre = (gridSize - 1) / 2;
  const kinds = new Uint8Array(gridSize * gridSize);
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const radial = Math.hypot((col - centre) / centre, (centre - row) / centre);
      kinds[row * gridSize + col] = radial <= readTo ? 1 : 0;
    }
  }
  return {
    gridSize,
    maxThetaDeg: 80,
    kinds,
    boresightAzimuthDeg: 0,
    boresightElevationDeg: 90,
    dishModel: "rev3Rectangular",
    ...overrides,
  };
}

const kindsOf = (data: Float32Array) => {
  const counts = [0, 0, 0, 0];
  for (let i = 3; i < data.length; i += 4) counts[data[i]]++;
  return counts;
};

describe("observedEnvelope", () => {
  it("follows the reach of the readings in every direction", () => {
    const envelope = observedEnvelope(survey(61, 0.6))!;
    expect(envelope).not.toBeNull();
    for (const reach of envelope) expect(reach).toBeCloseTo(0.6, 1);
  });

  it("is null before the dish has read anything, so nothing is trimmed", () => {
    expect(observedEnvelope(survey(61, -1))).toBeNull();
  });

  it("does not let one shallow direction pull the line in", () => {
    // A single spoke cut back to a third of the others' reach: the ±15° widening
    // should carry its neighbours across rather than cutting a bite out of it.
    const grid = survey(61, 0.6);
    const centre = 30;
    for (let row = 0; row < 61; row++) {
      for (let col = 0; col < 61; col++) {
        const east = (col - centre) / centre;
        const north = (centre - row) / centre;
        const azimuth = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
        const degrees = (azimuth * 180) / Math.PI;
        if (degrees >= 90 && degrees < 95 && Math.hypot(east, north) > 0.2) {
          grid.kinds[row * 61 + col] = 0;
        }
      }
    }
    const envelope = observedEnvelope(grid)!;
    const spread = Math.max(...envelope) - Math.min(...envelope);
    expect(spread).toBeLessThan(0.05);
  });

  it("carries a figure into directions that hold no reading at all", () => {
    // A 40° sector blanked end to end — wider than the ±15° reach, so it can
    // only be covered by the fill that follows.
    const grid = survey(61, 0.6);
    const centre = 30;
    for (let row = 0; row < 61; row++) {
      for (let col = 0; col < 61; col++) {
        const east = (col - centre) / centre;
        const north = (centre - row) / centre;
        const azimuth = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
        const degrees = (azimuth * 180) / Math.PI;
        if (degrees >= 100 && degrees < 140) grid.kinds[row * 61 + col] = 0;
      }
    }
    const envelope = observedEnvelope(grid)!;
    for (const reach of envelope) expect(reach).toBeGreaterThan(0);
  });
});

describe("buildDomePoints", () => {
  it("keeps every dot when the trim is off", () => {
    const [unmapped, clear] = kindsOf(buildDomePoints(survey(61, 0.6)));
    expect(clear).toBeGreaterThan(0);
    expect(unmapped).toBeGreaterThan(0);
  });

  it("drops the unmapped skirt when the trim is on", () => {
    const before = kindsOf(buildDomePoints(survey(61, 0.6), false));
    const after = kindsOf(buildDomePoints(survey(61, 0.6), true));
    expect(after[0]).toBeLessThan(before[0]);
  });

  it("never drops a reading, whatever its kind", () => {
    const grid = survey(61, 0.6);
    // Plant an obstruction at the very rim of the readings, where the trim works.
    grid.kinds[30 * 61 + 30 + 18] = 3;
    const before = kindsOf(buildDomePoints(grid, false));
    const after = kindsOf(buildDomePoints(grid, true));
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
  });

  it("places a UT-frame Mini's bottom rim on the north side of the dome", () => {
    // A single reading on the bottom-center cell. In FRAME_UT with the dish
    // facing north that cell is the boresight azimuth — geographic north —
    // which is −z in the scene (x east, y up, z south).
    const grid = survey(11, -1, { mapReferenceFrame: "FRAME_UT", boresightAzimuthDeg: 0 });
    grid.kinds[10 * 11 + 5] = 1;
    const points = buildDomePoints(grid);
    let found: [number, number, number] | null = null;
    for (let i = 0; i < points.length; i += 4) {
      if (points[i + 3] === 1) found = [points[i], points[i + 1], points[i + 2]];
    }
    expect(found).not.toBeNull();
    expect(found![0]).toBeCloseTo(0, 5); // east
    expect(found![2]).toBeLessThan(0); // south-axis: north is negative
  });

  it("spares unmapped sky that sits inside the envelope", () => {
    // A hole punched in the middle of the readings is never-observed sky the
    // trim must leave alone — it is the band overhead, not the skirt.
    const grid = survey(61, 0.6);
    for (let row = 26; row < 34; row++) {
      for (let col = 26; col < 34; col++) grid.kinds[row * 61 + col] = 0;
    }
    const after = kindsOf(buildDomePoints(grid, true));
    expect(after[0]).toBeGreaterThanOrEqual(8 * 8);
  });
});
