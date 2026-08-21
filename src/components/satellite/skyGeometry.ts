// Every vertex buffer the sky view draws, built as plain typed arrays.
//
// Pure data in, Float32Array out — no GL handles, no canvas, no frame loop. That
// is the point of the split: the scene owns GPU objects and timing, this owns
// shape, and shape can be reasoned about (and tested) on its own.
//
// Vertex layouts differ per builder and are what the scene's attribute pointers
// are cut to: dome points are xyz+kind, terrain/compass/dish are xyz+rgb, stars
// are xyz+size.

import { type DishModelMesh } from "./dishModels/types";
import type { DishModel } from "../../lib/dishMesh";
import { gridCellToEnu, type ObstructionMapFrame } from "../obstruction/obstructionFrame";

export interface SkySurvey {
  gridSize: number;
  maxThetaDeg: number;
  /** Per cell, row-major: 0 unmapped, 1 clear, 2 partial, 3 obstructed. */
  kinds: Uint8Array;
  boresightAzimuthDeg: number;
  boresightElevationDeg: number;
  /** How the grid is oriented. Defaults to earth-north when omitted (tests). */
  mapReferenceFrame?: ObstructionMapFrame;
  /** Which kit to draw at the centre. Rides the survey because it comes from the
   *  same status reply as the boresight, and lands just as late — so the rebuild
   *  that follows a status poll picks the model up without a second channel. */
  dishModel: DishModel;
}

/**
 * Light shared by every surface, so the dish and satellites agree with the
 * ground. Terrain and dish bake it into per-vertex colour here; the satellite
 * shader receives this same vector as a uniform, which is why it is exported
 * rather than kept private — one light, or the scene stops being consistent.
 */
export const LIGHT = ((): [number, number, number] => {
  const l: [number, number, number] = [-0.3, 0.9, -0.2];
  const m = Math.hypot(...l);
  return [l[0] / m, l[1] / m, l[2] / m];
})();

function decode<T extends Int16Array | Uint16Array>(
  base64: string,
  Type: new (buffer: ArrayBuffer) => T,
): T {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Type(bytes.buffer);
}

/**
 * The survey shell floats clear of the ground rather than sitting on it, so the
 * dish reads as standing beneath the sky instead of inside a cage. Only the dome
 * moves — the terrain, dish and compass stay put.
 */
const DOME_LIFT = 0.18;

/** The envelope's resolution: 72 spokes of 5°, widened across ±3 of them. */
const ENVELOPE_SPOKES = 72;
const ENVELOPE_REACH = 3;

/** Which spoke a cell falls in, from its offsets in grid radius. */
function spokeAt(east: number, north: number): number {
  const azimuth = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor((azimuth / (2 * Math.PI)) * ENVELOPE_SPOKES) % ENVELOPE_SPOKES;
}

/**
 * How far out the dish's readings reach, one figure per compass direction, in
 * grid radius (0 at the zenith, 1 at the rim).
 *
 * Taken as the furthest reading per direction, then widened to the furthest
 * within ±15° and averaged with its neighbours. Raw per-direction maxima are far
 * too jumpy to cut against: a single shallow reading drags the line inward and
 * takes a bite out of the sky above it, and directions the dish has never
 * pointed have no figure at all. Reaching sideways heals both — a direction is
 * covered by its neighbours, which are looking at the same patch of sky.
 *
 * Null when the dish has read nothing anywhere, which is the state a new kit
 * starts in: with no envelope to speak of, nothing should be trimmed.
 */
export function observedEnvelope(survey: SkySurvey): Float64Array | null {
  const { gridSize, kinds } = survey;
  const deepest = new Float64Array(ENVELOPE_SPOKES).fill(-1);
  let anyReading = false;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (kinds[row * gridSize + col] === 0) continue;
      const { east, north } = gridCellToEnu(
        row,
        col,
        gridSize,
        survey.mapReferenceFrame ?? "FRAME_EARTH",
        survey.boresightAzimuthDeg,
      );
      const radial = Math.hypot(east, north);
      if (radial > 1) continue;
      anyReading = true;
      const spoke = spokeAt(east, north);
      if (radial > deepest[spoke]) deepest[spoke] = radial;
    }
  }
  if (!anyReading) return null;

  const wrap = (k: number) => ((k % ENVELOPE_SPOKES) + ENVELOPE_SPOKES) % ENVELOPE_SPOKES;
  const reach = new Float64Array(ENVELOPE_SPOKES);
  for (let k = 0; k < ENVELOPE_SPOKES; k++) {
    let furthest = -1;
    for (let d = -ENVELOPE_REACH; d <= ENVELOPE_REACH; d++) {
      furthest = Math.max(furthest, deepest[wrap(k + d)]);
    }
    reach[k] = furthest;
  }
  // A sector wider than the reach still has no figure. Carry one across from the
  // nearest direction either side rather than leaving a hole — an untrimmed
  // sector hangs its skirt below the trimmed rim, which reads as a fin.
  for (let k = 0; k < ENVELOPE_SPOKES; k++) {
    if (reach[k] >= 0) continue;
    let before = k;
    let after = k;
    while (reach[wrap(before)] < 0) before--;
    while (reach[wrap(after)] < 0) after++;
    reach[k] = Math.max(reach[wrap(before)], reach[wrap(after)]);
  }

  const envelope = new Float64Array(ENVELOPE_SPOKES);
  for (let k = 0; k < ENVELOPE_SPOKES; k++) {
    envelope[k] = (reach[wrap(k - 1)] + reach[k] + reach[wrap(k + 1)]) / 3;
  }
  return envelope;
}

/**
 * `trimUnmapped` drops never-observed sky beyond the envelope, which is the wide
 * skirt around the dome's base — sky the dish cannot point at, drawn today as a
 * gray shell the readings sit inside. Only unmapped cells are ever dropped, so
 * no reading can be lost to it, and the never-observed band overhead survives
 * because it sits well within the envelope rather than past it.
 */
export function buildDomePoints(survey: SkySurvey, trimUnmapped = false) {
  const { gridSize, kinds } = survey;
  const maxTheta = (survey.maxThetaDeg * Math.PI) / 180;
  const envelope = trimUnmapped ? observedEnvelope(survey) : null;
  const out: number[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const { east, north } = gridCellToEnu(
        row,
        col,
        gridSize,
        survey.mapReferenceFrame ?? "FRAME_EARTH",
        survey.boresightAzimuthDeg,
      );
      const radial = Math.hypot(east, north);
      if (radial > 1) continue;
      const kind = kinds[row * gridSize + col];
      if (envelope && kind === 0 && radial > envelope[spokeAt(east, north)]) continue;
      const zenith = radial * maxTheta;
      const spread = radial === 0 ? 0 : Math.sin(zenith) / radial;
      out.push(east * spread, Math.cos(zenith) + DOME_LIFT, -north * spread, kind);
    }
  }
  return new Float32Array(out);
}

export function buildStars() {
  let seed = 42;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: number[] = [];
  for (let i = 0; i < 700; i++) {
    const az = rand() * Math.PI * 2;
    const el = Math.asin(rand() * 0.98 + 0.02);
    const r = 40;
    out.push(
      r * Math.cos(el) * Math.sin(az),
      r * Math.sin(el),
      -r * Math.cos(el) * Math.cos(az),
      0.6 + rand() * 1.8,
    );
  }
  return new Float32Array(out);
}

/** Faceted ground, flat-shaded by baking the light into per-vertex colour. */
export function buildTerrain() {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const N = 46,
    EXTENT = 9;
  const heights: number[] = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = (i / N - 0.5) * 2 * EXTENT,
        z = (j / N - 0.5) * 2 * EXTENT;
      const d = Math.hypot(x, z);
      const amp = Math.min(1, Math.max(0, (d - 0.9) / 2.5)) * (0.12 + 0.35 * rand());
      heights.push(amp * (rand() - 0.35));
    }
  }
  const at = (i: number, j: number): [number, number, number] => [
    (i / N - 0.5) * 2 * EXTENT,
    heights[i * (N + 1) + j],
    (j / N - 0.5) * 2 * EXTENT,
  ];
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const [a, b, c] = tri.map((k) => quad[k]);
        const ux = b[0] - a[0],
          uy = b[1] - a[1],
          uz = b[2] - a[2];
        const vx = c[0] - a[0],
          vy = c[1] - a[1],
          vz = c[2] - a[2];
        const nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const light = Math.max(
          0,
          (nx / nl) * LIGHT[0] + (ny / nl) * LIGHT[1] + (nz / nl) * LIGHT[2],
        );
        const midX = (a[0] + b[0] + c[0]) / 3,
          midZ = (a[2] + b[2] + c[2]) / 3;
        const fade = Math.min(1, Math.hypot(midX, midZ) / EXTENT);
        const base = 0.32 + light * 0.42;
        const cr = base * (0.72 - 0.28 * fade);
        const cg = base * (0.78 - 0.26 * fade);
        const cb = base * (0.88 - 0.18 * fade);
        for (const p of [a, b, c]) out.push(p[0], p[1], p[2], cr, cg, cb);
      }
    }
  }
  return new Float32Array(out);
}

const CARDINALS: Array<[string, number]> = [
  ["N", 0],
  ["E", Math.PI / 2],
  ["S", Math.PI],
  ["W", (3 * Math.PI) / 2],
];

/** Stroke paths for the cardinal letters, in a unit box, drawn as line pairs. */
const GLYPHS: Record<string, number[][][]> = {
  N: [
    [
      [0, 0],
      [0, 1],
    ],
    [
      [0, 1],
      [1, 0],
    ],
    [
      [1, 0],
      [1, 1],
    ],
  ],
  E: [
    [
      [1, 1],
      [0, 1],
    ],
    [
      [0, 1],
      [0, 0],
    ],
    [
      [0, 0],
      [1, 0],
    ],
    [
      [0, 0.5],
      [0.62, 0.5],
    ],
  ],
  S: [
    [
      [1, 1],
      [0, 1],
    ],
    [
      [0, 1],
      [0, 0.5],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
    [
      [1, 0.5],
      [1, 0],
    ],
    [
      [1, 0],
      [0, 0],
    ],
  ],
  W: [
    [
      [0, 1],
      [0.25, 0],
    ],
    [
      [0.25, 0],
      [0.5, 0.7],
    ],
    [
      [0.5, 0.7],
      [0.75, 0],
    ],
    [
      [0.75, 0],
      [1, 1],
    ],
  ],
};

/**
 * The dashed horizon ring and the N/E/S/W marks, as line segments so they share
 * the mesh program. Mirrors the dashboard dome: 96 segments with every other one
 * drawn, and the letters set out at radius 1.14, lying flat and reading outward.
 */
export function buildCompass() {
  const out: number[] = [];
  // The ground is only flat inside radius 0.9; past that its ridges reach ~0.03,
  // so the ring has to sit above them or it gets eaten in patches.
  const LIFT = 0.06;
  const push = (x: number, z: number, tint: number) =>
    out.push(x, LIFT, z, tint * 0.86, tint * 0.9, tint);

  // Radial ticks (like the app's bezel), each is a short
  // quad pointing outward from the centre — quads because a 1px GL line can't be
  // thickened. Brighter than the horizon ring, so the bezel reads as instrument
  // furniture rather than as part of the sky.
  const TICKS = 48;
  const R0 = 0.99,
    R1 = 1.05; // inner/outer radius of each tick
  const HALF = 0.006 / 2; // half the tangential thickness
  const TINT = 0.45;
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2;
    const dx = Math.sin(a),
      dz = -Math.cos(a); // radial outward
    const tx = Math.cos(a),
      tz = Math.sin(a); // tangential (thickness)
    const inx = dx * R0,
      inz = dz * R0,
      outx = dx * R1,
      outz = dz * R1;
    const a1: [number, number] = [inx - tx * HALF, inz - tz * HALF];
    const a2: [number, number] = [inx + tx * HALF, inz + tz * HALF];
    const b1: [number, number] = [outx - tx * HALF, outz - tz * HALF];
    const b2: [number, number] = [outx + tx * HALF, outz + tz * HALF];
    push(a1[0], a1[1], TINT);
    push(a2[0], a2[1], TINT);
    push(b2[0], b2[1], TINT);
    push(a1[0], a1[1], TINT);
    push(b2[0], b2[1], TINT);
    push(b1[0], b1[1], TINT);
  }
  return new Float32Array(out);
}

/**
 * The N/E/S/W letters as filled quad strokes (triangles), not GL lines: Chrome
 * caps line width at 1px, so the only way to a bold label is real geometry. Each
 * glyph stroke becomes a ribbon of the given width, laid flat on the ground and
 * reading outward, matching where buildCompass sets the ring.
 */
export function buildCompassLabels() {
  const out: number[] = [];
  const push = (x: number, z: number, tint: number) =>
    out.push(x, 0.06, z, tint * 0.86, tint * 0.9, tint);
  const SIZE = 0.13;
  const WIDTH = 0.015; // stroke thickness of the letters
  for (const [label, azimuth] of CARDINALS) {
    const cx = Math.sin(azimuth) * 1.16,
      cz = -Math.cos(azimuth) * 1.16;
    const rx = Math.cos(azimuth),
      rz = Math.sin(azimuth);
    const ux = Math.sin(azimuth),
      uz = -Math.cos(azimuth);
    const tint = label === "N" ? 0.8 : 0.46;
    const world = (gx: number, gy: number): [number, number] => {
      const dx = (gx - 0.5) * SIZE,
        dy = (gy - 0.5) * SIZE;
      return [cx + rx * dx + ux * dy, cz + rz * dx + uz * dy];
    };
    for (const [from, to] of GLYPHS[label]) {
      const A = world(from[0], from[1]),
        B = world(to[0], to[1]);
      let dx = B[0] - A[0],
        dz = B[1] - A[1];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const h = WIDTH / 2;
      const px = -dz * h,
        pz = dx * h; // perpendicular, across the stroke
      const ex = dx * h,
        ez = dz * h; // square caps so joints fill
      const a1: [number, number] = [A[0] - ex - px, A[1] - ez - pz];
      const a2: [number, number] = [A[0] - ex + px, A[1] - ez + pz];
      const b1: [number, number] = [B[0] + ex - px, B[1] + ez - pz];
      const b2: [number, number] = [B[0] + ex + px, B[1] + ez + pz];
      push(a1[0], a1[1], tint);
      push(a2[0], a2[1], tint);
      push(b2[0], b2[1], tint);
      push(a1[0], a1[1], tint);
      push(b2[0], b2[1], tint);
      push(b1[0], b1[1], tint);
    }
  }
  return new Float32Array(out);
}

/**
 * The dish, aimed at the live boresight and resting on the ground the way the
 * deployed kit does — the panel's low edge and the kickstand's feet are the
 * contact points, so the lowest vertex is dropped to y = 0.
 *
 * `scale` exaggerates it above true size. The dish is genuinely tiny against a
 * sky dome, which reads fine at full size but disappears on a dashboard card — so
 * the small surface draws it larger on purpose, trading accuracy for legibility.
 */
export function buildDish(model: DishModelMesh, survey: SkySurvey, scale = 1) {
  const mm = (0.5 * scale) / model.longAxisMm;
  const az = (survey.boresightAzimuthDeg * Math.PI) / 180;
  const el = (survey.boresightElevationDeg * Math.PI) / 180;
  const sa = Math.sin(az),
    ca = Math.cos(az),
    se = Math.sin(el),
    ce = Math.cos(el);
  // u across the face, v along it, w on the boresight. World is x east, y up,
  // z south. u is v x w so the frame is right-handed and outward faces stay lit.
  const w: [number, number, number] = [ce * sa, se, -ce * ca];
  const v: [number, number, number] = [-se * sa, ce, se * ca];
  const u: [number, number, number] = [-ca, 0, -sa];
  const place = (a: number, b: number, c: number): [number, number, number] => [
    a * u[0] + b * v[0] + c * w[0],
    a * u[1] + b * v[1] + c * w[1],
    a * u[2] + b * v[2] + c * w[2],
  ];

  // A motorised mount hinges rather than leaning as a whole: its foot stays flat
  // on the ground however the head is aimed, turning in azimuth with it but never
  // tilting. That is the same frame as `place` with the boresight straight up —
  // u carries over unchanged, having never depended on elevation — hung off the
  // pivot so the joint stays mated as the head swings.
  const joint = model.joint;
  const jx = ((joint?.pivot[0] ?? 0) / model.scale) * mm;
  const jy = ((joint?.pivot[1] ?? 0) / model.scale) * mm;
  const jz = ((joint?.pivot[2] ?? 0) / model.scale) * mm;
  const hinge = place(jx, jy, jz);
  const plant = (a: number, b: number, c: number): [number, number, number] => {
    const p = a - jx,
      q = b - jy,
      r = c - jz;
    return [p * u[0] - q * sa + hinge[0], r + hinge[1], p * u[2] + q * ca + hinge[2]];
  };

  const positions = decode(model.positions, Int16Array);
  const indices = decode(model.indices, Uint16Array);
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i < positions.length; i += 3) {
    const put = joint && i / 3 >= joint.baseVertex ? plant : place;
    points.push(
      put(
        (positions[i] / model.scale) * mm,
        (positions[i + 1] / model.scale) * mm,
        (positions[i + 2] / model.scale) * mm,
      ),
    );
  }

  const out: number[] = [];
  for (const [first, count, tint] of model.parts) {
    for (let t = 0; t < count; t++) {
      const o = (first + t) * 3;
      const a = points[indices[o]],
        b = points[indices[o + 1]],
        c = points[indices[o + 2]];
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2];
      const vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const lam = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
      const s = (0.3 + 0.7 * lam) * tint;
      for (const p of [a, b, c]) out.push(p[0], p[1], p[2], s * 0.94, s * 0.96, s);
    }
  }
  let low = Infinity;
  for (let i = 1; i < out.length; i += 6) low = Math.min(low, out[i]);
  for (let i = 1; i < out.length; i += 6) out[i] -= low;
  // How much room this model occupies, measured off the drawn vertices rather
  // than declared — but reported only for a model that asked to keep the camera
  // out, so the models that are happy being orbited closely stay untouched.
  let radius = 0;
  if (model.keepCameraOutside) {
    for (let i = 0; i < out.length; i += 6) {
      radius = Math.max(radius, Math.hypot(out[i], out[i + 1], out[i + 2]));
    }
  }
  // Where the beam leaves from: just clear of the sky-facing face, along the
  // boresight. Starting at the panel's centre buries half the ribbon inside the
  // dish, and the depth test then clips it — which reads as the beam abruptly
  // changing width exactly at the panel's edge.
  // The exit has to ride the same frame as the hardware it leaves. `place` swings
  // with the boresight, which is right when the panel swings with it — but a
  // model that is entirely planted (baseVertex 0) never moves, so `place` would
  // walk the beam off the dish as the served satellite changes. Follow whichever
  // branch this model's own vertices took.
  const [bx, by, bz] = model.beamOriginMm ?? [0, 0, 14];
  const exit = joint && joint.baseVertex === 0 ? plant : place;
  const centre = exit(bx * mm, by * mm, bz * mm);
  return {
    data: new Float32Array(out),
    origin: [centre[0], centre[1] - low, centre[2]] as const,
    radius,
  };
}
