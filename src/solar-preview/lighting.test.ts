import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { skyLighting } from "./lighting";

describe("lightweight preview lighting", () => {
  it("brightens as Sun rises through twilight and daytime", () => {
    const elevations = [-20, -12, -6, 0, 15, 30, 60];
    const brightness = elevations.map((elevation) => skyLighting(elevation, -10, 1).brightness);
    brightness.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(brightness[i]));
  });
  it("uses nighttime Moon illumination and elevation", () => {
    const newMoon = skyLighting(-30, 60, 0);
    const quarter = skyLighting(-30, 60, 0.5);
    const full = skyLighting(-30, 60, 1);
    expect(quarter.brightness).toBeGreaterThan(newMoon.brightness);
    expect(full.brightness).toBeGreaterThan(quarter.brightness);
    expect(full.starIntensity).toBeLessThan(newMoon.starIntensity);
    expect(skyLighting(-30, 20, 1).brightness).toBeLessThan(full.brightness);
    expect(skyLighting(30, 60, 1).moonContribution).toBe(0);
  });
  it("gives Moon no contribution at or below horizon", () => {
    for (const elevation of [-90, -1, 0]) {
      expect(skyLighting(-30, elevation, 1).moonContribution).toBe(0);
      expect(skyLighting(-30, elevation, 1).fog).toEqual(skyLighting(-30, 60, 0).fog);
    }
  });
  it("smoothly fades stars across twilight with bounded finite colors", () => {
    expect(skyLighting(-18, -1, 0).starIntensity).toBe(1);
    expect(skyLighting(-9, -1, 0).starIntensity).toBeCloseTo(0.5);
    expect(skyLighting(0, -1, 0).starIntensity).toBe(0);
    for (let sun = -90; sun <= 90; sun++) {
      const state = skyLighting(sun, 60, 1);
      for (const value of [...state.fog, state.starIntensity]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
  it("keeps astronomy outside scene frames and lighting free of trig", () => {
    const lighting = readFileSync(new URL("../lib/skyLighting.ts", import.meta.url), "utf8");
    const scene = readFileSync(
      new URL("../components/satellite/skyScene.ts", import.meta.url),
      "utf8",
    );
    expect(lighting).not.toMatch(/Math\.(?:sin|cos|tan|asin|acos|atan)/);
    expect(scene).not.toMatch(/celestialPositions|solarAtmosphere|skyLighting/);
  });
});
