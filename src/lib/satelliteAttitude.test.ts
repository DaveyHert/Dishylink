// The LVLH attitude basis, checked against geometry that can be reasoned about
// by hand rather than against a golden output of the same code.
//
// The tracker builds the triad inside a class that needs TLEs, so these tests
// exercise the same algebra through a local restatement of it and pin the
// properties the renderer depends on: orthonormality, handedness, and the two
// physical claims — nadir is anti-radial, and the nose follows the motion.

import { describe, expect, it } from "vitest";
import * as satelliteJs from "satellite.js";
import {
  StarlinkTracker,
  advanceLookAngles,
  type SatelliteAttitude,
  type TopocentricState,
} from "./satellites";

type Vec3 = [number, number, number];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** The triad exactly as satellites.ts derives it, before any frame change. */
function lvlh(position: Vec3, velocity: Vec3) {
  const length = norm(position);
  const radial: Vec3 = [position[0] / length, position[1] / length, position[2] / length];
  const w = cross(position, velocity);
  const wl = norm(w);
  const crossTrack: Vec3 = [w[0] / wl, w[1] / wl, w[2] / wl];
  const alongTrack = cross(crossTrack, radial);
  return { radial, alongTrack, crossTrack };
}

describe("LVLH triad", () => {
  // A circular equatorial orbit: position on +x, velocity on +y. Every axis is
  // then known by inspection, so a sign error cannot hide behind a plausible number.
  const position: Vec3 = [6921, 0, 0];
  const velocity: Vec3 = [0, 7.59, 0];

  it("puts radial along the position vector", () => {
    expect(lvlh(position, velocity).radial).toEqual([1, 0, 0]);
  });

  it("puts in-track along the direction of motion", () => {
    const { alongTrack } = lvlh(position, velocity);
    expect(alongTrack[0]).toBeCloseTo(0, 12);
    expect(alongTrack[1]).toBeCloseTo(1, 12);
    expect(alongTrack[2]).toBeCloseTo(0, 12);
  });

  it("puts cross-track on the orbit normal", () => {
    const { crossTrack } = lvlh(position, velocity);
    expect(crossTrack[0]).toBeCloseTo(0, 12);
    expect(crossTrack[1]).toBeCloseTo(0, 12);
    expect(crossTrack[2]).toBeCloseTo(1, 12);
  });

  it("is orthonormal for an inclined orbit", () => {
    const inclined: Vec3 = [4200, 3100, 4400];
    const motion: Vec3 = [-3.1, 6.2, -1.4];
    const { radial, alongTrack, crossTrack } = lvlh(inclined, motion);
    for (const axis of [radial, alongTrack, crossTrack]) expect(norm(axis)).toBeCloseTo(1, 12);
    expect(dot(radial, alongTrack)).toBeCloseTo(0, 12);
    expect(dot(radial, crossTrack)).toBeCloseTo(0, 12);
    expect(dot(alongTrack, crossTrack)).toBeCloseTo(0, 12);
  });

  it("is right-handed: R × S = W", () => {
    const inclined: Vec3 = [4200, 3100, 4400];
    const motion: Vec3 = [-3.1, 6.2, -1.4];
    const { radial, alongTrack, crossTrack } = lvlh(inclined, motion);
    const handed = cross(radial, alongTrack);
    expect(handed[0]).toBeCloseTo(crossTrack[0], 12);
    expect(handed[1]).toBeCloseTo(crossTrack[1], 12);
    expect(handed[2]).toBeCloseTo(crossTrack[2], 12);
  });

  it("keeps in-track aligned with velocity when the orbit is circular", () => {
    const inclined: Vec3 = [4200, 3100, 4400];
    // A velocity perpendicular to position — the circular-orbit case, where
    // in-track and the velocity direction coincide exactly.
    const perpendicular = cross(cross(inclined, [-3.1, 6.2, -1.4]), inclined);
    const scaleTo = 7.59 / norm(perpendicular);
    const motion: Vec3 = [
      perpendicular[0] * scaleTo,
      perpendicular[1] * scaleTo,
      perpendicular[2] * scaleTo,
    ];
    const { alongTrack } = lvlh(inclined, motion);
    const speed = norm(motion);
    expect(alongTrack[0]).toBeCloseTo(motion[0] / speed, 10);
    expect(alongTrack[1]).toBeCloseTo(motion[1] / speed, 10);
    expect(alongTrack[2]).toBeCloseTo(motion[2] / speed, 10);
  });
});

describe("attitude in the observer's ENU frame", () => {
  // The tracker's own frame conversion, driven directly so the case is
  // deterministic. Going through finePass instead would depend on a fixed TLE
  // being above the horizon on the day the suite runs — it is not, which made an
  // earlier version of this test pass while asserting nothing.
  type Internals = {
    attitudeFrom(position: Vec3, velocity: Vec3, gmst: number): SatelliteAttitude | undefined;
  };

  /** Observer on the equator at the prime meridian, with gmst 0 so ECEF = ECI.
   *  Local axes are then east [0,1,0], north [0,0,1], up [1,0,0] — which makes
   *  every expectation below checkable by hand. */
  const atOrigin = () =>
    new StarlinkTracker([], {
      latitudeDeg: 0,
      longitudeDeg: 0,
      altitudeM: 0,
    }) as unknown as Internals;

  // Directly overhead, travelling due east on an equatorial orbit.
  const overhead: Vec3 = [7000, 0, 0];
  const eastward: Vec3 = [0, 7.5, 0];

  it("reports radial as straight up for a satellite at the zenith", () => {
    const attitude = atOrigin().attitudeFrom(overhead, eastward, 0)!;
    expect(attitude.radial[0]).toBeCloseTo(0, 9); // east
    expect(attitude.radial[1]).toBeCloseTo(0, 9); // north
    expect(attitude.radial[2]).toBeCloseTo(1, 9); // up
  });

  it("reports in-track as due east for an eastbound equatorial orbit", () => {
    const attitude = atOrigin().attitudeFrom(overhead, eastward, 0)!;
    expect(attitude.alongTrack[0]).toBeCloseTo(1, 9);
    expect(attitude.alongTrack[1]).toBeCloseTo(0, 9);
    expect(attitude.alongTrack[2]).toBeCloseTo(0, 9);
  });

  it("reports the orbit normal as due north for that orbit", () => {
    const attitude = atOrigin().attitudeFrom(overhead, eastward, 0)!;
    expect(attitude.crossTrack[0]).toBeCloseTo(0, 9);
    expect(attitude.crossTrack[1]).toBeCloseTo(1, 9);
    expect(attitude.crossTrack[2]).toBeCloseTo(0, 9);
  });

  it("stays orthonormal through the rotation into ENU", () => {
    const attitude = atOrigin().attitudeFrom([4200, 3100, 4400], [-3.1, 6.2, -1.4], 1.234)!;
    const axes: Vec3[] = [attitude.radial, attitude.alongTrack, attitude.crossTrack];
    for (const axis of axes) expect(norm(axis)).toBeCloseTo(1, 9);
    expect(dot(axes[0], axes[1])).toBeCloseTo(0, 9);
    expect(dot(axes[0], axes[2])).toBeCloseTo(0, 9);
    expect(dot(axes[1], axes[2])).toBeCloseTo(0, 9);
  });

  it("gives up rather than emitting a NaN basis on a degenerate state", () => {
    // Velocity parallel to position: r × v is zero and the frame is undefined.
    expect(atOrigin().attitudeFrom([7000, 0, 0], [7.5, 0, 0], 0)).toBeUndefined();
  });

  it("points in-track along the direction the satellite actually moves", () => {
    // The discriminating check, and the one the renderer's nose axis rides on:
    // compare the analytic in-track axis against a numerical derivative of the
    // propagated position. They come from independent routes — SGP4's velocity
    // output versus its position output sampled twice — so agreement to a
    // fraction of a degree means the triad really is aligned with the motion,
    // through the frame change and all.
    const line1 = "1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993";
    const line2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350 12345";
    const satrec = satelliteJs.twoline2satrec(line1, line2);
    const at = new Date("2024-01-01T12:00:00Z");
    const soon = new Date(at.getTime() + 1000);
    const gmst = satelliteJs.gstime(at);

    const here = satelliteJs.propagate(satrec, at);
    const there = satelliteJs.propagate(satrec, soon);
    if (!here?.position || !here.velocity || !there?.position) throw new Error("no state vector");
    const p0 = here.position as { x: number; y: number; z: number };
    const p1 = there.position as { x: number; y: number; z: number };
    const v0 = here.velocity as { x: number; y: number; z: number };

    const tracker = atOrigin();
    const attitude = tracker.attitudeFrom([p0.x, p0.y, p0.z], [v0.x, v0.y, v0.z], gmst)!;

    // Where it went over one second, as a direction, put through the same frame
    // change so the two are directly comparable.
    const step: Vec3 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
    const stepLength = norm(step);
    const travelled = (tracker as unknown as { toEnu(d: Vec3, gmst: number): Vec3 }).toEnu(
      [step[0] / stepLength, step[1] / stepLength, step[2] / stepLength],
      gmst,
    );

    const cosine = Math.min(1, Math.max(-1, dot(attitude.alongTrack, travelled)));
    const offByDeg = (Math.acos(cosine) * 180) / Math.PI;
    expect(offByDeg).toBeLessThan(0.5);
  });

  it("propagates a real element set into a usable triad", () => {
    const line1 = "1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993";
    const line2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350 12345";
    const satrec = satelliteJs.twoline2satrec(line1, line2);
    expect(satrec.error).toBe(0);
    const state = satelliteJs.propagate(satrec, new Date("2024-01-01T12:00:00Z"));
    if (!state?.position || !state.velocity)
      throw new Error("propagation produced no state vector");
    const position = state.position as { x: number; y: number; z: number };
    const velocity = state.velocity as { x: number; y: number; z: number };
    const attitude = atOrigin().attitudeFrom(
      [position.x, position.y, position.z],
      [velocity.x, velocity.y, velocity.z],
      satelliteJs.gstime(new Date("2024-01-01T12:00:00Z")),
    )!;
    expect(attitude).toBeDefined();
    for (const axis of [attitude.radial, attitude.alongTrack, attitude.crossTrack]) {
      expect(norm(axis)).toBeCloseTo(1, 9);
    }
  });
});

describe("look-angle extrapolation", () => {
  // The frame-skip fix: advancing by velocity between SGP4 samples must land
  // where a fresh propagation would. The tracker exposes topocentric state via
  // finePass, but that depends on a satellite being up; here the internal path
  // is driven so the case is deterministic. The bar is a fraction of a degree
  // over 100 ms — the interval the renderer actually bridges.
  type Internals = {
    lookAngles(
      satrec: satelliteJs.SatRec,
      atDate: Date,
      gmst: number,
      withAttitude: boolean,
    ): {
      azimuthDeg: number;
      elevationDeg: number;
      rangeKm: number;
      topocentric?: TopocentricState;
    } | null;
  };

  const line1 = "1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993";
  const line2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350 12345";

  it("matches a fresh propagation 100 ms later", () => {
    const satrec = satelliteJs.twoline2satrec(line1, line2);
    const base = new Date("2024-01-01T12:00:00Z");
    const gmst = satelliteJs.gstime(base);

    // Put the observer at the sub-satellite point so the pass is guaranteed and
    // fixed: the satellite sits near the zenith, well above the horizon.
    const state = satelliteJs.propagate(satrec, base);
    if (!state?.position) throw new Error("no state vector");
    const ground = satelliteJs.eciToGeodetic(
      state.position as { x: number; y: number; z: number },
      gmst,
    );
    const tracker = new StarlinkTracker([], {
      latitudeDeg: satelliteJs.radiansToDegrees(ground.latitude),
      longitudeDeg: satelliteJs.radiansToDegrees(ground.longitude),
      altitudeM: 0,
    }) as unknown as Internals;

    const sample = tracker.lookAngles(satrec, base, gmst, true)!;
    expect(sample.topocentric).toBeDefined();
    const later = new Date(base.getTime() + 100);
    const truth = tracker.lookAngles(satrec, later, satelliteJs.gstime(later), true)!;
    const advanced = advanceLookAngles(sample.topocentric!, 0.1);

    // Compare as pointing directions, so an azimuth wrap near a pole can't
    // masquerade as a large error.
    const toVec = (azDeg: number, elDeg: number) => {
      const az = (azDeg * Math.PI) / 180,
        el = (elDeg * Math.PI) / 180;
      return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
    };
    const a = toVec(advanced.azimuthDeg, advanced.elevationDeg);
    const t = toVec(truth.azimuthDeg, truth.elevationDeg);
    const cosine = Math.min(1, Math.max(-1, a[0] * t[0] + a[1] * t[1] + a[2] * t[2]));
    const offByDeg = (Math.acos(cosine) * 180) / Math.PI;
    expect(offByDeg).toBeLessThan(0.05);
    expect(Math.abs(advanced.rangeKm - truth.rangeKm)).toBeLessThan(0.5);
  });

  it("returns the sample itself at dt = 0", () => {
    const topo: TopocentricState = { position: [100, 800, 400], velocity: [-5, 2, -3] };
    const at = advanceLookAngles(topo, 0);
    const range = Math.hypot(100, 800, 400);
    expect(at.rangeKm).toBeCloseTo(range, 6);
    expect(at.elevationDeg).toBeCloseTo((Math.asin(400 / range) * 180) / Math.PI, 6);
  });
});
