import { describe, expect, it } from "vitest";
import { celestialPositions, horizontal } from "./celestial";
import {
  MARKER_RADIUS,
  markerMesh,
  markerPosition,
} from "../components/satellite/celestialMarkers";

const at = (time: string, lat = 0, lon = 105) => celestialPositions(lat, lon, new Date(time));

describe("celestial preview", () => {
  it("places Sun high at local noon and below horizon at midnight", () => {
    expect(at("2026-10-03T05:00:00Z").sun.elevation).toBeGreaterThan(70);
    expect(at("2026-10-03T17:00:00Z").sun.elevation).toBeLessThan(-60);
  });
  it("changes both bodies with location and time", () => {
    const first = at("2026-10-03T05:00:00Z");
    for (const other of [at("2026-10-03T11:00:00Z"), at("2026-10-03T05:00:00Z", 50, -70)]) {
      for (const body of ["sun", "moon"] as const) {
        expect(Math.abs(first[body].elevation - other[body].elevation)).toBeGreaterThan(5);
        expect(other[body].azimuth).toBeGreaterThanOrEqual(0);
        expect(other[body].azimuth).toBeLessThan(360);
      }
    }
  });
  it("matches equinox noon and solstice polar sanity cases", () => {
    expect(at("2026-03-20T12:00:00Z", 0, 0).sun.elevation).toBeGreaterThan(85);
    expect(at("2026-03-20T12:00:00Z", 0, 180).sun.elevation).toBeLessThan(-85);
    expect(at("2026-06-21T00:00:00Z", 90, 0).sun.elevation).toBeCloseTo(23.44, 0);
    expect(at("2026-12-21T12:00:00Z", 90, 0).sun.elevation).toBeCloseTo(-23.44, 0);
  });
  it("matches known 2024 eclipse new Moon and March full Moon", () => {
    expect(at("2024-04-08T18:00:00Z").moon.illumination).toBeLessThan(0.001);
    expect(at("2024-04-08T18:00:00Z").moon.phase).toBe("Bulan baru");
    expect(at("2024-03-25T07:00:00Z").moon.illumination).toBeGreaterThan(0.999);
    expect(at("2024-03-25T07:00:00Z").moon.phase).toBe("Purnama");
    expect(at("2024-04-15T19:00:00Z").moon.illumination).toBeCloseTo(0.5, 1);
    expect(at("2024-04-15T19:00:00Z").moon.phase).toBe("Membesar");
  });
  it("applies substantial lunar parallax near horizon", () => {
    const moon = at("2026-10-03T17:00:00Z").moon;
    expect(moon.geocentricElevation - moon.elevation).toBeGreaterThan(0.5);
    expect(moon.geocentricElevation - moon.elevation).toBeLessThan(1.1);
  });
  it("maps ENU bearings and hides horizon/below-horizon geometry", () => {
    expect(horizontal([0, 1, 0], 0, 0).azimuth).toBe(90);
    expect(horizontal([0, 0, 1], 0, 0).azimuth).toBe(0);
    const east = markerPosition({ azimuth: 90, elevation: 30 })!;
    expect(Math.hypot(...east)).toBeCloseTo(MARKER_RADIUS);
    expect(Math.hypot(...east)).toBeGreaterThan(3.6);
    expect(east[0] / MARKER_RADIUS).toBeCloseTo(Math.sqrt(3) / 2);
    expect(east[1] / MARKER_RADIUS).toBeCloseTo(0.5);
    expect(east[2]).toBeCloseTo(0);
    const north = markerPosition({ azimuth: 0, elevation: 30 })!;
    expect(north[2] / MARKER_RADIUS).toBeCloseTo(-Math.sqrt(3) / 2);
    const below = { azimuth: 0, elevation: -1 };
    expect(markerPosition(below)).toBeNull();
    expect(markerPosition({ ...below, elevation: 0 })).toBeNull();
    expect(markerMesh(below, below, [3, 2, 3]).length).toBe(0);
    const mesh = markerMesh({ azimuth: 90, elevation: 30 }, below, [3, 2, 3]);
    expect(mesh.length).toBeGreaterThan(32 * 18);
    expect([...mesh].every(Number.isFinite)).toBe(true);
  });
  it("rejects invalid coordinates and dates", () => {
    expect(() => at("bad")).toThrow(RangeError);
    expect(() => at("2026-10-03T05:00:00Z", 91)).toThrow(RangeError);
    expect(() => at("2026-10-03T05:00:00Z", 0, 181)).toThrow(RangeError);
  });
});
