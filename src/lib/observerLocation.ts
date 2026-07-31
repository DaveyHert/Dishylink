// Observer (dish site) coordinates for satellite tracking.
//
// SpaceX removed local-API GPS (get_location) for consumer plans in May 2026
// — it now answers PermissionDenied on Residential no matter what — so the
// observer location comes from, in order: the dish itself (still works on
// Priority plans), a saved location, or the browser's geolocation / manual
// entry. Satellite look-angles only need ~km accuracy.

import type { ObserverLocation } from "./satellites";

const LOCATION_STORAGE_KEY = "dishboard-observer-location";
const LOCATION_CLEARED_KEY = "dishboard-observer-cleared";

export function loadSavedLocation(): ObserverLocation | null {
  try {
    const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as ObserverLocation;
    if (typeof parsed.latitudeDeg !== "number" || typeof parsed.longitudeDeg !== "number")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Whether the user explicitly cleared their location, as opposed to never having
 * set one. The two are different intents and must stay distinguishable: an
 * automatic source may fill in for someone who has never chosen, but must never
 * undo a deliberate clear — "clear" means unset, not "revert to a guess".
 */
export function loadLocationCleared(): boolean {
  try {
    return localStorage.getItem(LOCATION_CLEARED_KEY) === "true";
  } catch {
    return false;
  }
}

// The cleared flag is maintained by the two writers below rather than by their
// callers, so the pair can never drift out of step.

export function saveLocation(location: ObserverLocation): void {
  localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
  localStorage.removeItem(LOCATION_CLEARED_KEY); // choosing a location un-clears
}

export function clearSavedLocation(): void {
  localStorage.removeItem(LOCATION_STORAGE_KEY);
  localStorage.setItem(LOCATION_CLEARED_KEY, "true");
}

/**
 * Parse pasted coordinates: "6.5244, 3.3792", "6.5244 3.3792", including
 * the degree-suffixed forms Google Maps copies.
 */
export function parseCoordinateText(coordinateText: string): ObserverLocation | null {
  const numbers = coordinateText.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const latitude = Number(numbers[0]);
  const longitude = Number(numbers[1]);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { latitudeDeg: latitude, longitudeDeg: longitude, altitudeM: 0 };
}

/**
 * City-level fallback from the public IP. On Starlink this resolves toward
 * your point of presence, so it can be off by up to a few hundred km —
 * fine for the sky view, worth refining with exact coordinates.
 */
export async function requestIpLocation(): Promise<ObserverLocation> {
  const response = await fetch("https://get.geojs.io/v1/ip/geo.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const geo = (await response.json()) as { latitude?: string; longitude?: string };
  // geojs returns the coordinates as strings, and a missing field coerces to NaN.
  const latitudeDeg = Number(geo.latitude);
  const longitudeDeg = Number(geo.longitude);
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
    throw new Error("no coordinates in response");
  }
  return { latitudeDeg, longitudeDeg, altitudeM: 0 };
}

/** Resolve via the browser's geolocation permission prompt. */
export function requestBrowserLocation(): Promise<ObserverLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitudeDeg: position.coords.latitude,
          longitudeDeg: position.coords.longitude,
          altitudeM: position.coords.altitude ?? 0,
        });
      },
      (positionError) => reject(new Error(positionError.message)),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 3_600_000 },
    );
  });
}
