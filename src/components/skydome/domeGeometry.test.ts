import { describe, expect, it } from "vitest";
import { buildDomePoints, skyToWorld, liveKindAtCell, snapshotKindAtCell } from "./domeGeometry";
import {
  CELL_CLEAR,
  CELL_OBSTRUCTED,
  CELL_PARTIAL,
  CELL_UNMAPPED,
} from "../../lib/obstructionSnapshots";

describe("skyToWorld", () => {
  it("puts the zenith straight up, with no horizontal component", () => {
    const zenith = skyToWorld(0, 90);
    expect(zenith.z).toBeCloseTo(1);
    expect(Math.hypot(zenith.x, zenith.y)).toBeCloseTo(0);
  });

  it("maps azimuth 0/90/180/270 to north/east/south/west on the horizon", () => {
    // The dome's axes are x=east, y=north, so due north is +y and due east +x.
    expect(skyToWorld(0, 0).y).toBeCloseTo(1);
    expect(skyToWorld(90, 0).x).toBeCloseTo(1);
    expect(skyToWorld(180, 0).y).toBeCloseTo(-1);
    expect(skyToWorld(270, 0).x).toBeCloseTo(-1);
  });

  it("returns unit vectors at every elevation", () => {
    for (const elevation of [0, 15, 45, 70, 90]) {
      const point = skyToWorld(37, elevation);
      expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1);
    }
  });
});

describe("buildDomePoints", () => {
  const gridSize = 21;

  it("drops the grid's corners, which fall outside the dish's field of view", () => {
    const points = buildDomePoints(gridSize, 80, () => "clear");
    // A full square would be 11×11 sampled at stride 2; the inscribed circle is
    // strictly smaller, so the corners must have been discarded.
    expect(points.length).toBeLessThan(11 * 11);
    expect(points.length).toBeGreaterThan(0);
  });

  it("keeps every point on the unit sphere", () => {
    for (const point of buildDomePoints(gridSize, 80, () => "obstructed")) {
      expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1);
    }
  });

  it("puts the grid's centre cell at the zenith", () => {
    const points = buildDomePoints(gridSize, 80, () => "clear");
    const zenith = points.find((point) => point.z > 0.9999);
    expect(zenith).toBeDefined();
    expect(Math.hypot(zenith!.x, zenith!.y)).toBeCloseTo(0);
  });

  it("never reaches further than maxThetaDeg from the zenith", () => {
    const maxThetaDeg = 62;
    const lowest = buildDomePoints(gridSize, maxThetaDeg, () => "clear").reduce(
      (min, point) => Math.min(min, point.z),
      1,
    );
    // z = cos(zenith angle), so the smallest z is the widest angle reached.
    expect(Math.acos(lowest) * (180 / Math.PI)).toBeLessThanOrEqual(maxThetaDeg + 1e-9);
  });

  it("skips cells the classifier rejects", () => {
    expect(buildDomePoints(gridSize, 80, () => null)).toHaveLength(0);
  });
});

describe("liveKindAtCell", () => {
  //          clear  obstructed  partial  never observed
  const grid = [1, 0, 0.85, -1];
  const kindAt = liveKindAtCell(grid, 2);

  it("reads a negative usable fraction as never observed", () => {
    expect(kindAt(1, 1)).toBe("unmapped");
  });

  it("calls a fully usable cell clear and a fully blocked one obstructed", () => {
    expect(kindAt(0, 0)).toBe("clear");
    expect(kindAt(0, 1)).toBe("obstructed");
  });

  it("puts a partly blocked cell in between", () => {
    expect(kindAt(1, 0)).toBe("partial");
  });
});

describe("snapshotKindAtCell", () => {
  it("maps each stored bucket back to its kind", () => {
    const cells = Uint8Array.from([CELL_UNMAPPED, CELL_CLEAR, CELL_PARTIAL, CELL_OBSTRUCTED]);
    const kindAt = snapshotKindAtCell(cells, 2);
    expect(kindAt(0, 0)).toBe("unmapped");
    expect(kindAt(0, 1)).toBe("clear");
    expect(kindAt(1, 0)).toBe("partial");
    expect(kindAt(1, 1)).toBe("obstructed");
  });
});
