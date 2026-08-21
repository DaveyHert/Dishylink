import { describe, expect, it } from "vitest";
import { gridCellToEnu, resolveObstructionFrame, skyDirectionToGrid } from "./obstructionFrame";

describe("resolveObstructionFrame", () => {
  it("trusts an explicit earth or UT frame", () => {
    expect(resolveObstructionFrame("FRAME_EARTH", "mini1")).toBe("FRAME_EARTH");
    expect(resolveObstructionFrame("FRAME_UT", "rev4Standard")).toBe("FRAME_UT");
  });

  it("treats a Mini with no frame as UT, and a Standard as earth", () => {
    expect(resolveObstructionFrame(undefined, "mini1")).toBe("FRAME_UT");
    expect(resolveObstructionFrame(undefined, "mini2")).toBe("FRAME_UT");
    expect(resolveObstructionFrame("FRAME_UNKNOWN", "rev4Standard")).toBe("FRAME_EARTH");
  });
});

describe("gridCellToEnu", () => {
  const size = 11;
  const centre = 5;

  it("reads top-center as north in the earth frame", () => {
    const { east, north } = gridCellToEnu(0, centre, size, "FRAME_EARTH", 0);
    expect(east).toBeCloseTo(0);
    expect(north).toBeCloseTo(1);
  });

  it("reads bottom-center as north in the UT frame when the dish faces north", () => {
    const { east, north } = gridCellToEnu(size - 1, centre, size, "FRAME_UT", 0);
    expect(east).toBeCloseTo(0);
    expect(north).toBeCloseTo(1);
  });

  it("flips a Mini-style UT map 180° versus the earth reading of the same cell", () => {
    const earth = gridCellToEnu(0, centre, size, "FRAME_EARTH", 0);
    const ut = gridCellToEnu(0, centre, size, "FRAME_UT", 0);
    expect(ut.north).toBeCloseTo(-earth.north);
    expect(ut.east).toBeCloseTo(earth.east);
  });

  it("rotates a UT map so the bottom rim follows the boresight", () => {
    const { east, north } = gridCellToEnu(size - 1, centre, size, "FRAME_UT", 90);
    expect(east).toBeCloseTo(1);
    expect(north).toBeCloseTo(0);
  });
});

describe("skyDirectionToGrid", () => {
  const size = 11;
  const centre = 5;

  it("is the inverse of gridCellToEnu on the earth frame", () => {
    const { east, north } = gridCellToEnu(1, 8, size, "FRAME_EARTH", 0);
    const azimuth = (Math.atan2(east, north) * 180) / Math.PI;
    const radial = Math.hypot(east, north);
    const { row, col } = skyDirectionToGrid(azimuth, radial, size, "FRAME_EARTH", 0);
    expect(row).toBe(1);
    expect(col).toBe(8);
  });

  it("puts due north on the bottom rim of a north-facing UT map", () => {
    const { row, col } = skyDirectionToGrid(0, 1, size, "FRAME_UT", 0);
    expect(row).toBe(size - 1);
    expect(col).toBe(centre);
  });

  it("puts due north on the top rim of an earth map", () => {
    const { row, col } = skyDirectionToGrid(0, 1, size, "FRAME_EARTH", 0);
    expect(row).toBe(0);
    expect(col).toBe(centre);
  });
});
