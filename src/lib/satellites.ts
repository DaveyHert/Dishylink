// Starlink constellation tracking from SpaceX's published ephemerides.
// TLEs come from CelesTrak's supplemental set (SpaceX-supplied, via the
// /celestrak proxy), cached in localStorage. SGP4 propagation via
// satellite.js: a coarse pass over the whole constellation keeps a "near
// sky" shortlist; a throttled fine pass gives live look angles for
// everything actually above the horizon.

import * as satelliteJs from "satellite.js";

const TLE_URL = "/celestrak/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle";
const TLE_CACHE_KEY = "dishboard-starlink-tles";
const TLE_MAX_AGE_MS = 6 * 3_600_000;
const COARSE_ELEVATION_FLOOR_DEG = -12; // keep sats about to rise
const FINE_ELEVATION_FLOOR_DEG = 2;
const FINE_PASS_THROTTLE_MS = 100;
export const SERVING_ELEVATION_FLOOR_DEG = 25; // Starlink's approximate minimum service elevation

export interface ObserverLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
}

/** A direction in the observer's local frame: east, north, up. */
export type EnuDirection = [number, number, number];

/**
 * The satellite's orbital (LVLH) frame — the standard attitude basis for a
 * nadir-pointing spacecraft, which is how Starlink flies. Built from the
 * propagated state vector and delivered in the observer's ENU frame, so a
 * renderer never has to know about TEME or sidereal time.
 *
 * The triad is derived in the inertial frame, where position and velocity are
 * natively consistent, and only then rotated here. That ordering matters:
 * velocity does not change frames by rotation alone (an Earth-fixed velocity
 * needs the −ω × r transport term), but a *direction* does, so building the
 * basis first and rotating it after sidesteps the transport term entirely.
 */
export interface SatelliteAttitude {
  /** R — radial, pointing away from Earth's centre. Nadir is its negation. */
  radial: EnuDirection;
  /** S — in-track, the direction of motion. */
  alongTrack: EnuDirection;
  /** W — cross-track, the orbit normal (r × v). Solar arrays lie along it. */
  crossTrack: EnuDirection;
}

export interface SatelliteSky {
  name: string;
  /** Height above Earth's surface and orbital speed, from the propagated state. */
  altitudeKm?: number;
  speedKmS?: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  /** Present on the fine pass only — the coarse sweep does not need it. */
  attitude?: SatelliteAttitude;
}

type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

interface TleRecord {
  name: string;
  line1: string;
  line2: string;
}

export async function loadStarlinkTles(): Promise<TleRecord[]> {
  let tleText: string | null = null;
  try {
    const cached = localStorage.getItem(TLE_CACHE_KEY);
    if (cached) {
      const parsedCache = JSON.parse(cached) as { fetchedAtMs: number; text: string };
      if (Date.now() - parsedCache.fetchedAtMs < TLE_MAX_AGE_MS) tleText = parsedCache.text;
    }
  } catch {
    // corrupt cache — refetch
  }
  if (!tleText) {
    const tleResponse = await fetch(TLE_URL);
    if (!tleResponse.ok) throw new Error(`TLE fetch failed: HTTP ${tleResponse.status}`);
    tleText = await tleResponse.text();
    if (!tleText.includes("\n1 ")) throw new Error("TLE fetch returned unexpected content");
    try {
      localStorage.setItem(TLE_CACHE_KEY, JSON.stringify({ fetchedAtMs: Date.now(), text: tleText }));
    } catch {
      // storage full — run uncached
    }
  }

  const lines = tleText.split(/\r?\n/);
  const tleRecords: TleRecord[] = [];
  for (let lineIndex = 0; lineIndex + 2 < lines.length + 1; lineIndex += 3) {
    const name = lines[lineIndex]?.trim();
    const line1 = lines[lineIndex + 1];
    const line2 = lines[lineIndex + 2];
    if (name && line1?.startsWith("1 ") && line2?.startsWith("2 ")) {
      tleRecords.push({ name, line1, line2 });
    }
  }
  return tleRecords;
}

const FORECAST_OFFSETS_MINUTES = [5, 10, 15, 20, 25, 30];

export class StarlinkTracker {
  private readonly satellites: Array<{ name: string; satrec: satelliteJs.SatRec }>;
  private readonly observerGd: satelliteJs.GeodeticLocation;
  /** Local east/north/up axes at the observer, as ECEF vectors. */
  private readonly east: Vec3;
  private readonly north: Vec3;
  private readonly zenith: Vec3;
  private nearSkyIndices: number[] = [];
  private lastFinePass: { atMs: number; inView: SatelliteSky[] } = { atMs: 0, inView: [] };
  private forecastMinServiceable: number | null = null;

  constructor(tleRecords: TleRecord[], observer: ObserverLocation) {
    this.satellites = tleRecords
      .map((tle) => ({ name: tle.name, satrec: satelliteJs.twoline2satrec(tle.line1, tle.line2) }))
      .filter((entry) => entry.satrec.error === 0);
    this.observerGd = {
      latitude: satelliteJs.degreesToRadians(observer.latitudeDeg),
      longitude: satelliteJs.degreesToRadians(observer.longitudeDeg),
      height: observer.altitudeM / 1000,
    };
    // Geodetic latitude is the right one here: these axes define the local
    // vertical, which is the normal to the ellipsoid, not the geocentric radius.
    const { latitude, longitude } = this.observerGd;
    const sinLat = Math.sin(latitude), cosLat = Math.cos(latitude);
    const sinLon = Math.sin(longitude), cosLon = Math.cos(longitude);
    this.east = [-sinLon, cosLon, 0];
    this.north = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
    this.zenith = [cosLat * cosLon, cosLat * sinLon, sinLat];
  }

  /** An inertial (TEME) direction expressed in the observer's ENU frame. */
  private toEnu(direction: Vec3, gmst: number): EnuDirection {
    const ecf = satelliteJs.eciToEcf({ x: direction[0], y: direction[1], z: direction[2] }, gmst);
    const inEcf: Vec3 = [ecf.x, ecf.y, ecf.z];
    return [
      inEcf[0] * this.east[0] + inEcf[1] * this.east[1] + inEcf[2] * this.east[2],
      inEcf[0] * this.north[0] + inEcf[1] * this.north[1] + inEcf[2] * this.north[2],
      inEcf[0] * this.zenith[0] + inEcf[1] * this.zenith[1] + inEcf[2] * this.zenith[2],
    ];
  }

  get constellationSize(): number {
    return this.satellites.length;
  }

  private lookAngles(
    satrec: satelliteJs.SatRec,
    atDate: Date,
    gmst: number,
    withAttitude = false,
  ): SatelliteSky | null {
    const propagated = satelliteJs.propagate(satrec, atDate);
    if (!propagated?.position) return null;
    const positionEcf = satelliteJs.eciToEcf(propagated.position, gmst);
    const look = satelliteJs.ecfToLookAngles(this.observerGd, positionEcf);
    const position = propagated.position;
    const velocity = propagated.velocity;
    const EARTH_RADIUS_KM = 6371;
    return {
      name: "",
      azimuthDeg: satelliteJs.radiansToDegrees(look.azimuth),
      elevationDeg: satelliteJs.radiansToDegrees(look.elevation),
      rangeKm: look.rangeSat,
      altitudeKm: Math.hypot(position.x, position.y, position.z) - EARTH_RADIUS_KM,
      speedKmS: velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : undefined,
      // Only the fine pass asks for this: the coarse sweep runs seven
      // propagations across the whole constellation and never renders anything.
      attitude:
        withAttitude && velocity
          ? this.attitudeFrom(
              [position.x, position.y, position.z],
              [velocity.x, velocity.y, velocity.z],
              gmst,
            )
          : undefined,
    };
  }

  /** The LVLH triad from an inertial state vector, expressed in observer ENU. */
  private attitudeFrom(position: Vec3, velocity: Vec3, gmst: number): SatelliteAttitude | undefined {
    const radial = normalise(position);
    const crossTrack = cross(position, velocity);
    // Degenerate only if r and v are parallel, which no real orbit produces —
    // but a zeroed velocity from a decayed TLE would, so guard rather than
    // emit a NaN basis that would silently corrupt every vertex downstream.
    if (Math.hypot(crossTrack[0], crossTrack[1], crossTrack[2]) < 1e-9) return undefined;
    const normal = normalise(crossTrack);
    const alongTrack = cross(normal, radial);
    return {
      radial: this.toEnu(radial, gmst),
      alongTrack: this.toEnu(alongTrack, gmst),
      crossTrack: this.toEnu(normal, gmst),
    };
  }

  /**
   * Sweep the whole constellation (chunked so the main thread never stalls):
   * refreshes the near-sky shortlist AND the 30-minute forecast in one pass —
   * the forecast must consider every satellite, since LEO satellites cross
   * the whole sky in minutes and the ones serving you in half an hour are
   * below the horizon right now. Call every ~60s.
   */
  async coarsePass(): Promise<void> {
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);
    const nowGmst = satelliteJs.gstime(nowDate);
    const forecastTimes = FORECAST_OFFSETS_MINUTES.map((offsetMinutes) => {
      const atDate = new Date(nowMs + offsetMinutes * 60_000);
      return { atDate, gmst: satelliteJs.gstime(atDate) };
    });
    const serviceableAtOffset = new Array(forecastTimes.length).fill(0) as number[];
    const shortlist: number[] = [];
    const CHUNK_SIZE = 500;
    for (let startIndex = 0; startIndex < this.satellites.length; startIndex += CHUNK_SIZE) {
      const endIndex = Math.min(startIndex + CHUNK_SIZE, this.satellites.length);
      for (let satelliteIndex = startIndex; satelliteIndex < endIndex; satelliteIndex++) {
        const satrec = this.satellites[satelliteIndex].satrec;
        const skyNow = this.lookAngles(satrec, nowDate, nowGmst);
        if (skyNow && skyNow.elevationDeg > COARSE_ELEVATION_FLOOR_DEG) shortlist.push(satelliteIndex);
        forecastTimes.forEach((forecastTime, offsetIndex) => {
          const skyLater = this.lookAngles(satrec, forecastTime.atDate, forecastTime.gmst);
          if (skyLater && skyLater.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG) {
            serviceableAtOffset[offsetIndex]++;
          }
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.nearSkyIndices = shortlist;
    this.forecastMinServiceable = Math.min(...serviceableAtOffset);
  }

  /** Live look angles for satellites above the horizon. Throttled internally. */
  finePass(): SatelliteSky[] {
    const nowMs = Date.now();
    if (nowMs - this.lastFinePass.atMs < FINE_PASS_THROTTLE_MS) return this.lastFinePass.inView;
    const atDate = new Date(nowMs);
    const gmst = satelliteJs.gstime(atDate);
    const inView: SatelliteSky[] = [];
    for (const satelliteIndex of this.nearSkyIndices) {
      const entry = this.satellites[satelliteIndex];
      const sky = this.lookAngles(entry.satrec, atDate, gmst, true);
      if (sky && sky.elevationDeg > FINE_ELEVATION_FLOOR_DEG) {
        sky.name = entry.name;
        inView.push(sky);
      }
    }
    inView.sort((first, second) => second.elevationDeg - first.elevationDeg);
    this.lastFinePass = { atMs: nowMs, inView };
    return inView;
  }

  /** Minimum serviceable count over the next 30 min (computed by coarsePass). */
  forecastMinimumInView(): number | null {
    return this.forecastMinServiceable;
  }
}
