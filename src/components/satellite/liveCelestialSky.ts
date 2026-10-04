import { celestialPositions } from "../../lib/celestial";
import { skyLighting } from "../../lib/skyLighting";
import type { ObserverLocation } from "../../lib/satellites";
import { markerMesh } from "./celestialMarkers";

export const CELESTIAL_UPDATE_MS = 30_000;
const EMPTY_MARKERS = new Float32Array(0);

/** Cached astronomy; render callbacks only read light and build camera-facing markers. */
export function createLiveCelestialSky() {
  let celestial: ReturnType<typeof celestialPositions> | null = null;
  let lighting = skyLighting(-90, -90, 0);
  return {
    update(location: Pick<ObserverLocation, "latitudeDeg" | "longitudeDeg"> | null, nowMs: number) {
      celestial = null;
      lighting = skyLighting(-90, -90, 0);
      if (
        !location ||
        !Number.isFinite(location.latitudeDeg) ||
        Math.abs(location.latitudeDeg) > 90 ||
        !Number.isFinite(location.longitudeDeg) ||
        Math.abs(location.longitudeDeg) > 180 ||
        !Number.isFinite(nowMs)
      )
        return;
      celestial = celestialPositions(location.latitudeDeg, location.longitudeDeg, new Date(nowMs));
      lighting = skyLighting(
        celestial.sun.elevation,
        celestial.moon.elevation,
        celestial.moon.illumination,
      );
    },
    atmosphere: () => lighting,
    worldMarkers: (eye: number[]) =>
      celestial ? markerMesh(celestial.sun, celestial.moon, eye) : EMPTY_MARKERS,
  };
}
