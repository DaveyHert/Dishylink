import { describe, expect, it } from "vitest";
import { celestialPositions } from "../../lib/celestial";
import { skyLighting } from "../../lib/skyLighting";
import { createLiveCelestialSky, CELESTIAL_UPDATE_MS } from "./liveCelestialSky";

const location = { latitudeDeg: 0, longitudeDeg: 105 };
const noon = Date.parse("2026-10-03T05:00:00Z");
const midnight = Date.parse("2026-10-03T17:00:00Z");

describe("live celestial sky cache", () => {
  it("uses supplied real-clock instant and resolved coordinates", () => {
    const sky = createLiveCelestialSky();
    sky.update(location, noon);
    const positions = celestialPositions(
      location.latitudeDeg,
      location.longitudeDeg,
      new Date(noon),
    );
    expect(sky.atmosphere()).toEqual(
      skyLighting(positions.sun.elevation, positions.moon.elevation, positions.moon.illumination),
    );
    expect(sky.atmosphere().stars).toBe(false);
    expect(sky.worldMarkers([3, 2, 3]).length).toBeGreaterThan(0);
    sky.update(location, midnight);
    expect(sky.atmosphere().stars).toBe(true);
    expect(CELESTIAL_UPDATE_MS).toBe(30_000);
  });

  it("render callbacks reuse cached astronomy until explicit update", () => {
    const sky = createLiveCelestialSky();
    sky.update(location, noon);
    const cached = sky.atmosphere();
    for (let i = 0; i < 100; i++) {
      expect(sky.atmosphere()).toBe(cached);
      expect([...sky.worldMarkers([3, 2, 3])].every(Number.isFinite)).toBe(true);
    }
    sky.update({ latitudeDeg: 50, longitudeDeg: -70 }, noon);
    expect(sky.atmosphere()).not.toEqual(cached);
  });

  it("missing or invalid coordinates immediately clear markers and restore night", () => {
    const sky = createLiveCelestialSky();
    for (const invalid of [
      null,
      { latitudeDeg: 91, longitudeDeg: 0 },
      { latitudeDeg: 0, longitudeDeg: NaN },
    ]) {
      sky.update(location, noon);
      sky.update(invalid, midnight);
      expect(sky.worldMarkers([3, 2, 3]).length).toBe(0);
      expect(sky.atmosphere()).toEqual(skyLighting(-90, -90, 0));
    }
  });
});
