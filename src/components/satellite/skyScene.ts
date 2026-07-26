// The sky view's WebGL scene: obstruction dome, ground, the user's dish, and the
// live constellation overhead. Framework-free — React owns the canvas element and
// the data, this owns the GL objects and the frame loop.
//
// Four passes share one depth buffer so the layering is physical rather than
// painted: stars, then terrain and dish, then satellites, then the dome dots last
// so a dot in front of the dish stays visible and one behind it is hidden.

import { advanceLookAngles, type SatelliteSky } from "../../lib/satellites";

import { meshForModel } from "./dishModels";
import { lookAt, multiply, perspective } from "./skyMath";
import {
  LIGHT,
  buildCompass,
  buildCompassLabels,
  buildDish,
  buildDomePoints,
  buildStars,
  buildTerrain,
  type SkySurvey,
} from "./skyGeometry";
import { createPrograms } from "./skyPrograms";
import { createSkyCamera } from "./skyCamera";

// Re-exported so callers keep importing the scene's vocabulary from the scene,
// even though the type now lives with the geometry that consumes it.
export type { SkySurvey };

/** A scene position projected into CSS pixels, with `behind` set once it is off-camera. */
export interface ScreenPoint {
  x: number;
  y: number;
  behind: boolean;
}

export interface SkyTracker {
  name: string;
  report: (at: ScreenPoint | null) => void;
}

export interface SkyScene {
  /** Swap the obstruction data or boresight without rebuilding the scene. */
  setSurvey(survey: SkySurvey): void;
  /** Whether the never-observed skirt around the dome's base is drawn. */
  setTrimUnmapped(trim: boolean): void;
  /** Imperative sampler from the satellite feed; null while it is not active. */
  setSampler(sample: (() => SatelliteSky[]) | null): void;
  /** The likely serving satellite, drawn with a beam from the dish. */
  setServing(sky: SatelliteSky | null): void;
  /**
   * Anchors DOM elements to satellites: each entry is reported its subject's
   * screen position every frame, so labels track without a React render per frame.
   */
  setTrackers(trackers: SkyTracker[]): void;
  /** This frame's data for a satellite, so an open card can stay live. */
  getSatellite(name: string): SatelliteSky | null;
  /** Called with the satellite under a click, or null when the sky was empty. */
  setOnPick(pick: ((sky: SatelliteSky | null) => void) | null): void;
  toggleRotation(): boolean;
  /** Whether the camera is rotating, so a fresh scene's button starts honest. */
  isRotating(): boolean;
  /** Show or hide the whole dome; returns the new state. Not persisted — a fresh
   *  scene starts with the dome shown. Only this scene's dome, never the card's. */
  toggleDome(): boolean;
  isDomeVisible(): boolean;
  /** Gently ease the camera's tilt and zoom back to the opening framing. */
  resetView(): void;
  dispose(): void;
}

/** Sky dots sit at radius 1; the constellation shell is pushed out from there. */
const SATELLITE_SHELL = 2;
/**
 * Wing span as a fraction of the dome radius, grown with the shell so apparent
 * size holds. Real ranges spread the shell over 2.2–3.6, and anything larger
 * than this reads as a fleet of airliners rather than a constellation.
 */
const SATELLITE_SIZE = (0.032 * SATELLITE_SHELL) / 22;
const MAX_SATELLITES = 400;

/** How many points span a trail, and how far apart in time they sit. The two
 *  together set the trail's length in time — a short streak behind the craft,
 *  with enough points along it that the ribbon stays smooth. */
const TRAIL_MAX_POINTS = 12;
const TRAIL_INTERVAL_MS = 550;

/** Matches the dashboard's dark --page (#000000) so the canvas and the chrome agree. */
const FOG: [number, number, number] = [0, 0, 0];

/** "#rrggbb" or "rgb(r, g, b)" → 0–1 components; null if it is neither. */
function parseColor(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (!rgb) return null;
  const parts = rgb[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

/**
 * The survey palette, read from the tokens as they resolve ON THE CANVAS rather
 * than on the document. The sky view pins itself to the dark set with a
 * `data-theme` on its own wrapper, so the document still carries whatever theme
 * the app is in — reading there would paint a light-mode dome onto a night sky.
 */
function surveyPalette(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: [number, number, number]) =>
    parseColor(style.getPropertyValue(name)) ?? fallback;
  return {
    unmapped: read("--sky-unmapped", [0.486, 0.486, 0.486]),
    clear: read("--sky-clear", [1, 1, 1]),
    partial: read("--sky-partial", [0.431, 0.059, 0.059]),
    obstructed: read("--sky-obstructed", [0.961, 0.118, 0.118]),
  };
}

export interface SatelliteMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  triangleCount: number;
}

export interface SkySceneOptions {
  /** Builds the craft model. Omitted, the scene carries no satellite machinery
   *  at all — no mesh, no instance buffers, no trail or beam passes — which is
   *  what the dashboard card wants: the same dome, none of the constellation. */
  buildSatelliteMesh?: () => SatelliteMesh;
  /** The starfield behind the dome. */
  stars?: boolean;
  /** Fixed framing, and whether the wheel may change it. */
  distance?: number;
  zoomable?: boolean;
  /** Draws the dish above true size — see buildDish. */
  dishScale?: number;
  /** Drops the never-observed skirt around the dome's base — see buildDomePoints. */
  trimUnmapped?: boolean;
}

export function createSkyScene(
  canvas: HTMLCanvasElement,
  initialSurvey: SkySurvey,
  {
    buildSatelliteMesh,
    stars = true,
    distance,
    zoomable = true,
    dishScale = 1,
    trimUnmapped: initialTrim = false,
  }: SkySceneOptions = {},
): SkyScene | null {
  const context = canvas.getContext("webgl", { antialias: true }) as WebGLRenderingContext | null;
  if (!context) return null;
  // Bind to a non-nullable local: the frame loop and callbacks below close over
  // it, and narrowing does not survive into those.
  const gl = context;
  const instancing = gl.getExtension("ANGLE_instanced_arrays");

  const {
    dot: dotProgram,
    star: starProgram,
    mesh: meshProgram,
    sat: satProgram,
    beam: beamProgram,
    trail: trailProgram,
  } = createPrograms(gl);

  const buffer = (data: Float32Array, usage: number = gl.STATIC_DRAW) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return b;
  };

  const palette = surveyPalette(canvas);
  let survey = initialSurvey;
  let trimUnmapped = initialTrim;
  let domeData = buildDomePoints(survey, trimUnmapped);
  let domeVisible = true;
  let dish = buildDish(meshForModel(survey.dishModel), survey, dishScale);
  let dishData = dish.data;
  const starData = stars ? buildStars() : null;
  const terrainData = buildTerrain();
  const compassData = buildCompass();
  const labelData = buildCompassLabels();

  const domeBuffer = buffer(domeData, gl.DYNAMIC_DRAW);
  const starBuffer = starData ? buffer(starData) : null;
  const terrainBuffer = buffer(terrainData);
  const compassBuffer = buffer(compassData);
  const labelBuffer = buffer(labelData);
  const dishBuffer = buffer(dishData, gl.DYNAMIC_DRAW);

  // Built only where satellites are drawn. A scene without them holds no craft
  // mesh and no per-instance buffers, rather than uploading both to never use
  // them — `satellites` being null is what every satellite pass checks.
  const satellites = buildSatelliteMesh
    ? (() => {
        const mesh = buildSatelliteMesh();
        return {
          mesh,
          pos: buffer(mesh.positions),
          normal: buffer(mesh.normals),
          color: buffer(mesh.colors),
          offset: buffer(new Float32Array(MAX_SATELLITES * 3), gl.DYNAMIC_DRAW),
          right: buffer(new Float32Array(MAX_SATELLITES * 3), gl.DYNAMIC_DRAW),
          up: buffer(new Float32Array(MAX_SATELLITES * 3), gl.DYNAMIC_DRAW),
          forward: buffer(new Float32Array(MAX_SATELLITES * 3), gl.DYNAMIC_DRAW),
        };
      })()
    : null;
  const offsets = new Float32Array(MAX_SATELLITES * 3);
  const rights = new Float32Array(MAX_SATELLITES * 3);
  const ups = new Float32Array(MAX_SATELLITES * 3);
  const forwards = new Float32Array(MAX_SATELLITES * 3);
  let satelliteCount = 0;
  /** Who to draw the beam to. Its position is re-read every frame, not stored. */
  let servingName: string | null = null;
  let beamTarget: [number, number, number] | null = null;
  /** This frame's satellites and their world positions, kept for picking and labels. */
  let frameSky: SatelliteSky[] = [];
  let framePositions: Array<[number, number, number]> = [];
  /** This frame's trails, one per drawn satellite, oldest point first. Rebuilt
   *  each frame from the live sample rather than accumulated across frames. */
  let frameTrails: Array<Array<[number, number, number]>> = [];
  /** Last frame's view-projection, reused by picking so a click matches what is drawn. */
  let lastMvp = new Float32Array(16);
  let trackers: SkyTracker[] = [];
  let onPick: ((sky: SatelliteSky | null) => void) | null = null;
  const beamVerts = new Float32Array(6 * 5); // two triangles, xyz + across + along
  const beamBuffer = buffer(beamVerts, gl.DYNAMIC_DRAW);
  let sampleSatellites: (() => SatelliteSky[]) | null = null;

  // The wake ribbon's vertices. It is camera-facing, so it needs the eye and is
  // assembled in `drawTrails` from this frame's trail points rather than here.
  // Two triangles (6 vertices) per segment, each xyz + across + glow (5 floats);
  // sized for the whole cap up front so the buffer never reallocates.
  const TRAIL_FLOATS_PER_VERTEX = 5; // position, across, glow — colour is fixed in the shader
  const trailVerts = new Float32Array(
    MAX_SATELLITES * (TRAIL_MAX_POINTS - 1) * 6 * TRAIL_FLOATS_PER_VERTEX,
  );
  const trailBuffer = buffer(trailVerts, gl.DYNAMIC_DRAW);

  /**
   * Place instances from live sky positions. Azimuth and elevation give the
   * direction — the part that has to be right — and range only sets how far out
   * along that ray the model is drawn, so the shell scale is purely cosmetic.
   */
  /** Look angles to a world point: azimuth and elevation give the true bearing,
   *  range only sets how far out along that ray the model sits (cosmetic). */
  function lookAnglesToWorld(
    azimuthDeg: number,
    elevationDeg: number,
    rangeKm: number,
  ): [number, number, number] {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const radius = SATELLITE_SHELL * (1.12 + (Math.max(rangeKm, 550) / 550 - 1) * 0.26);
    return [
      Math.cos(el) * Math.sin(az) * radius,
      Math.sin(el) * radius,
      -Math.cos(el) * Math.cos(az) * radius,
    ];
  }

  /**
   * Display position for a tracked satellite: true bearing, cosmetic radius.
   * Look angles are advanced to the current instant from the sample they came
   * from — SGP4 runs at ~10 Hz, this draws at 60, so without the extrapolation
   * a satellite would hold still for six frames and then jump, which is obvious
   * once it fills the view. The velocity is exact enough over that 100 ms gap.
   */
  function skyToWorld(sat: SatelliteSky): [number, number, number] {
    if (sat.topocentric && sat.sampledAtMs !== undefined) {
      const dt = Math.min(0.25, Math.max(0, (Date.now() - sat.sampledAtMs) / 1000));
      const { azimuthDeg, elevationDeg, rangeKm } = advanceLookAngles(sat.topocentric, dt);
      return lookAnglesToWorld(azimuthDeg, elevationDeg, rangeKm);
    }
    return lookAnglesToWorld(sat.azimuthDeg, sat.elevationDeg, sat.rangeKm);
  }

  /**
   * The trail as a pure function of the current sample, not a stored history: the
   * head is the live position and each earlier point is that sample stepped one
   * interval further back by its ENU velocity — the same first-order transport
   * advanceLookAngles runs forward for the live position, read the other way.
   * Because nothing is accumulated across frames, a paused render loop (a hidden
   * tab, a debugger, a GC hitch) leaves no stale point to bridge on return; the
   * path is simply drawn correct for the new instant. Ordered oldest-first so it
   * matches drawTrails, which fades from the tail up to the head at the end.
   */
  function buildTrail(
    sat: SatelliteSky,
    head: [number, number, number],
    nowMs: number,
  ): Array<[number, number, number]> {
    if (!sat.topocentric || sat.sampledAtMs === undefined) return [head];
    const nowDt = Math.min(0.25, Math.max(0, (nowMs - sat.sampledAtMs) / 1000));
    const points: Array<[number, number, number]> = [];
    for (let k = TRAIL_MAX_POINTS - 1; k >= 1; k--) {
      const dt = nowDt - (k * TRAIL_INTERVAL_MS) / 1000;
      const { azimuthDeg, elevationDeg, rangeKm } = advanceLookAngles(sat.topocentric, dt);
      points.push(lookAnglesToWorld(azimuthDeg, elevationDeg, rangeKm));
    }
    points.push(head); // k = 0: the live head, coincident with the drawn craft
    return points;
  }

  /**
   * World position to CSS pixels. `mvp` is column-major, so element (column c,
   * row r) is at index c * 4 + r.
   */
  function toScreen(mvp: Float32Array, p: readonly number[]): ScreenPoint {
    const clipX = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const clipY = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const clipW = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (clipW <= 0) return { x: 0, y: 0, behind: true };
    return {
      x: ((clipX / clipW) * 0.5 + 0.5) * canvas.clientWidth,
      y: (0.5 - (clipY / clipW) * 0.5) * canvas.clientHeight,
      behind: false,
    };
  }

  /** Nearest satellite to a point on screen, within a forgiving tap radius. */
  function pickAt(clientX: number, clientY: number): SatelliteSky | null {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left,
      y = clientY - rect.top;
    const RADIUS = 26;
    let best: SatelliteSky | null = null;
    let bestDistance = RADIUS;
    for (let i = 0; i < frameSky.length; i++) {
      const at = toScreen(lastMvp, framePositions[i]);
      if (at.behind) continue;
      const distance = Math.hypot(at.x - x, at.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = frameSky[i];
      }
    }
    return best;
  }

  function drawBeam(mvp: Float32Array, eye: number[]) {
    if (!beamTarget) return;
    const a = dish.origin,
      b = beamTarget;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / dl, dy / dl, dz / dl];
    const ex = eye[0] - a[0],
      ey = eye[1] - a[1],
      ez = eye[2] - a[2];
    // Ribbon lies perpendicular to both the beam and the view, so it always faces us.
    let sx = dir[1] * ez - dir[2] * ey;
    let sy = dir[2] * ex - dir[0] * ez;
    let sz = dir[0] * ey - dir[1] * ex;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl;
    sy /= sl;
    sz /= sl;
    // Width scales with each end's distance from the camera, so the beam holds a
    // constant thickness on screen. A fixed world width instead renders wide at
    // the dish and thins toward the satellite — the taper is just perspective.
    const APPARENT = 0.02;
    const halfWidth = (p: readonly number[]) =>
      Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]) * APPARENT;
    // along: 0 at the dish end, 1 at the satellite — lets the fragment fade the base.
    const corner = (p: readonly number[], side: number, i: number, along: number) => {
      const w = halfWidth(p) * side;
      beamVerts[i] = p[0] + sx * w;
      beamVerts[i + 1] = p[1] + sy * w;
      beamVerts[i + 2] = p[2] + sz * w;
      beamVerts[i + 3] = side;
      beamVerts[i + 4] = along;
    };
    corner(a, -1, 0, 0);
    corner(b, -1, 5, 1);
    corner(b, 1, 10, 1);
    corner(a, -1, 15, 0);
    corner(b, 1, 20, 1);
    corner(a, 1, 25, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, beamBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, beamVerts);
    gl.useProgram(beamProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(beamProgram, "uMvp"), false, mvp);
    const aPos = gl.getAttribLocation(beamProgram, "aPos");
    const aAcross = gl.getAttribLocation(beamProgram, "aAcross");
    const aAlong = gl.getAttribLocation(beamProgram, "aAlong");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aAcross);
    gl.vertexAttribPointer(aAcross, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(aAlong);
    gl.vertexAttribPointer(aAlong, 1, gl.FLOAT, false, 20, 16);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive: light, not paint
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function refreshSatellites() {
    if (!satellites || !sampleSatellites) {
      satelliteCount = 0;
      beamTarget = null;
      frameTrails = [];
      return;
    }
    const sky = sampleSatellites();
    const floorDeg = 90 - survey.maxThetaDeg;
    const nowMs = Date.now();
    beamTarget = null;
    frameSky = [];
    framePositions = [];
    frameTrails = [];
    let n = 0;
    for (const sat of sky) {
      if (n >= MAX_SATELLITES) break;
      if (sat.elevationDeg < floorDeg) continue; // outside the dome's coverage
      const at = skyToWorld(sat);

      // The trail behind the craft, derived from this frame's sample — see
      // buildTrail. Rebuilt every frame, so leaving and re-entering the view (or
      // the render loop pausing) carries no stale state to clean up or bridge.
      frameTrails.push(buildTrail(sat, at, nowMs));
      // Take the beam's endpoint from this same per-frame sample. Holding the
      // serving satellite's own object instead would pin the beam to whatever
      // React last handed us — about once a second — and it would visibly step
      // while the satellites around it moved smoothly.
      if (servingName !== null && sat.name === servingName) beamTarget = at;
      frameSky.push(sat);
      framePositions.push(at);
      offsets[n * 3] = at[0];
      offsets[n * 3 + 1] = at[1];
      offsets[n * 3 + 2] = at[2];
      // Attitude from the propagated state vector: the tracker hands over the
      // LVLH triad in ENU, and the scene's axes are east/up/south, so mapping is
      // a relabelling. Nadir-pointing, nose along track — how the hardware flies.
      //
      // The fallback matters: it is not just belt-and-braces. `attitude` is
      // absent whenever the propagator returned no velocity, and it is absent on
      // every satellite until the first fine pass lands, so without it the
      // constellation would render with a NaN basis and vanish.
      let up: number[];
      let fx: number, fy: number, fz: number;
      if (sat.attitude) {
        const { radial, alongTrack } = sat.attitude;
        up = [radial[0], radial[2], -radial[1]];
        fx = alongTrack[0];
        fy = alongTrack[2];
        fz = -alongTrack[1];
      } else {
        const shell = Math.hypot(at[0], at[1], at[2]) || 1;
        up = [at[0] / shell, at[1] / shell, at[2] / shell];
        const ref = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        fx = ref[1] * up[2] - ref[2] * up[1];
        fy = ref[2] * up[0] - ref[0] * up[2];
        fz = ref[0] * up[1] - ref[1] * up[0];
      }
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const rx = fy * up[2] - fz * up[1];
      const ry = fz * up[0] - fx * up[2];
      const rz = fx * up[1] - fy * up[0];
      const rl = Math.hypot(rx, ry, rz) || 1;
      rights[n * 3] = rx / rl;
      rights[n * 3 + 1] = ry / rl;
      rights[n * 3 + 2] = rz / rl;
      ups[n * 3] = up[0];
      ups[n * 3 + 1] = up[1];
      ups[n * 3 + 2] = up[2];
      forwards[n * 3] = fx;
      forwards[n * 3 + 1] = fy;
      forwards[n * 3 + 2] = fz;
      n++;
    }
    satelliteCount = n;
    for (const [b, data] of [
      [satellites.offset, offsets],
      [satellites.right, rights],
      [satellites.up, ups],
      [satellites.forward, forwards],
    ] as Array<[WebGLBuffer, Float32Array]>) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
  }

  /**
   * The satellite trails: a soft, camera-facing ribbon down each path, turned to
   * face the eye — which is why the mesh is assembled here, at draw, rather than
   * with the trail points in refreshSatellites. It is rebuilt every frame from
   * frameTrails, which is itself re-derived from the live sample each frame, so
   * there is no held ribbon that a stalled loop could leave stale. A faint white
   * wisp that dies away behind the craft — additive, so it glows rather than paints.
   */
  function drawTrails(mvp: Float32Array, eye: number[]) {
    if (frameTrails.length === 0) return;
    // Half-width as a fraction of distance, so the trail holds its apparent size
    // whatever the zoom, widening only slightly along its length.
    const HEAD_WIDTH = 0.004,
      TAIL_FLARE = 0.8;
    // Peak brightness at the craft. Low: the trail is a hint of where it has
    // been, not a burning exhaust.
    const HEAD_GLOW = 0.3;
    let v = 0;
    const side = (point: [number, number, number], dir: number[]): [number, number, number] => {
      const ex = eye[0] - point[0],
        ey = eye[1] - point[1],
        ez = eye[2] - point[2];
      const sx = dir[1] * ez - dir[2] * ey,
        sy = dir[2] * ex - dir[0] * ez,
        sz = dir[0] * ey - dir[1] * ex;
      const sl = Math.hypot(sx, sy, sz) || 1;
      return [sx / sl, sy / sl, sz / sl];
    };
    const distTo = (p: [number, number, number]) =>
      Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]);
    for (const trail of frameTrails) {
      const length = trail.length;
      if (length < 2) continue;
      for (let i = 1; i < length; i++) {
        const a = trail[i - 1],
          b = trail[i];
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          dz = b[2] - a[2];
        const dl = Math.hypot(dx, dy, dz) || 1;
        const dir = [dx / dl, dy / dl, dz / dl];
        const sideA = side(a, dir),
          sideB = side(b, dir);
        // Fraction along the whole trail: 0 at the oldest tail, 1 at the head.
        const fa = (i - 1) / (length - 1),
          fb = i / (length - 1);
        // Width widens toward the tail; glow sits at the head and dies away
        // behind (squared, so most of the length is barely there).
        const wa = HEAD_WIDTH * distTo(a) * (1 + (1 - fa) * TAIL_FLARE);
        const wb = HEAD_WIDTH * distTo(b) * (1 + (1 - fb) * TAIL_FLARE);
        const ga = fa * fa * HEAD_GLOW,
          gb = fb * fb * HEAD_GLOW;
        const push = (
          p: [number, number, number],
          s: [number, number, number],
          w: number,
          across: number,
          glow: number,
        ) => {
          trailVerts[v++] = p[0] + s[0] * w * across;
          trailVerts[v++] = p[1] + s[1] * w * across;
          trailVerts[v++] = p[2] + s[2] * w * across;
          trailVerts[v++] = across;
          trailVerts[v++] = glow;
        };
        // Two triangles bridging cross-sections a and b.
        push(a, sideA, wa, -1, ga);
        push(b, sideB, wb, -1, gb);
        push(b, sideB, wb, 1, gb);
        push(a, sideA, wa, -1, ga);
        push(b, sideB, wb, 1, gb);
        push(a, sideA, wa, 1, ga);
      }
    }
    if (v === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, trailBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailVerts.subarray(0, v));
    gl.useProgram(trailProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(trailProgram, "uMvp"), false, mvp);
    const stride = TRAIL_FLOATS_PER_VERTEX * 4;
    const aPos = gl.getAttribLocation(trailProgram, "aPos");
    const aAcross = gl.getAttribLocation(trailProgram, "aAcross");
    const aGlow = gl.getAttribLocation(trailProgram, "aGlow");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aAcross);
    gl.vertexAttribPointer(aAcross, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(aGlow);
    gl.vertexAttribPointer(aGlow, 1, gl.FLOAT, false, stride, 16);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive: light, not paint
    gl.depthMask(false); // glow over the sky without carving into the depth buffer
    gl.drawArrays(gl.TRIANGLES, 0, v / TRAIL_FLOATS_PER_VERTEX);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // The camera owns orbit, zoom and inertia; resolving a tap into a satellite
  // needs this frame's sky and matrix, which live here, so it reports the tap
  // and we answer it.
  const camera = createSkyCamera(canvas, {
    distance,
    zoomable,
    // Nothing to resolve a tap into where there are no satellites, so the card
    // does not listen for one.
    onTap: satellites
      ? (clientX, clientY) => {
          if (onPick) onPick(pickAt(clientX, clientY));
        }
      : undefined,
  });

  // ── knob ───────────────────────────────────────────────────────────────────
  // How far outside its own radius a model that asked for clearance holds the
  // camera. 1.0 grazes the hull, higher backs off. Models that did not ask report
  // no radius at all, so no value here can reach them.
  const DISH_CLEARANCE = 1.1;
  const holdCameraClear = () => camera.setMinDistance(dish.radius * DISH_CLEARANCE);
  holdCameraClear();

  const resize = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  addEventListener("resize", resize);
  resize();

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);

  const bindMesh = (buf: WebGLBuffer, count: number, mode: number = gl.TRIANGLES) => {
    const aPos = gl.getAttribLocation(meshProgram, "aPos");
    const aColor = gl.getAttribLocation(meshProgram, "aColor");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(mode, 0, count);
  };

  function drawSatellites(mvp: Float32Array) {
    if (!satellites || !instancing || satelliteCount === 0) return;
    gl.useProgram(satProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(satProgram, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(satProgram, "uScale"), SATELLITE_SIZE);
    gl.uniform3f(gl.getUniformLocation(satProgram, "uFog"), FOG[0], FOG[1], FOG[2]);
    gl.uniform3f(gl.getUniformLocation(satProgram, "uLight"), LIGHT[0], LIGHT[1], LIGHT[2]);
    const bind = (name: string, buf: WebGLBuffer, divisor: number) => {
      const loc = gl.getAttribLocation(satProgram, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      instancing.vertexAttribDivisorANGLE(loc, divisor);
      return loc;
    };
    const locs = [
      bind("aPos", satellites.pos, 0),
      bind("aNormal", satellites.normal, 0),
      bind("aColor", satellites.color, 0),
      bind("iOffset", satellites.offset, 1),
      bind("iRight", satellites.right, 1),
      bind("iUp", satellites.up, 1),
      bind("iForward", satellites.forward, 1),
    ];
    instancing.drawArraysInstancedANGLE(
      gl.TRIANGLES,
      0,
      satellites.mesh.triangleCount * 3,
      satelliteCount,
    );
    // Leave the divisors clean or the next pass inherits them.
    for (const loc of locs) instancing.vertexAttribDivisorANGLE(loc, 0);
  }

  let frameHandle = 0;
  let previous = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    refreshSatellites();

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const { eye, target } = camera.view(now, dt);
    const mvp = multiply(
      // Near stays as far out as the closest approach allows (dish edge ~0.2 away
      // at min zoom): a tiny near plane wrecks depth precision and the dish faces
      // z-fight at distance. Far must reach the stars at radius 40.
      perspective(0.9, canvas.width / Math.max(1, canvas.height), 0.12, 90),
      lookAt(eye, target, [0, 1, 0]),
    );

    if (starBuffer && starData) {
      gl.depthMask(false);
      gl.useProgram(starProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(starProgram, "uMvp"), false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
      const aStar = gl.getAttribLocation(starProgram, "aStar");
      gl.enableVertexAttribArray(aStar);
      gl.vertexAttribPointer(aStar, 4, gl.FLOAT, false, 16, 0);
      gl.drawArrays(gl.POINTS, 0, starData.length / 4);
      gl.depthMask(true);
    }

    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, "uMvp"), false, mvp);
    gl.uniform3f(gl.getUniformLocation(meshProgram, "uFog"), FOG[0], FOG[1], FOG[2]);
    bindMesh(terrainBuffer, terrainData.length / 6);
    bindMesh(dishBuffer, dishData.length / 6);
    bindMesh(compassBuffer, compassData.length / 6);
    bindMesh(labelBuffer, labelData.length / 6);

    // Wakes under the craft and the beam, so a satellite and its serving beam
    // both sit crisply on top of the haze rather than behind it.
    drawTrails(mvp, eye);
    drawSatellites(mvp);
    drawBeam(mvp, eye);

    // Feed the DOM label its position for this frame. Reporting through a
    // callback keeps it out of React state, which cannot run at frame rate.
    lastMvp = mvp;
    for (const tracker of trackers) {
      const index = frameSky.findIndex((s) => s.name === tracker.name);
      tracker.report(index < 0 ? null : toScreen(mvp, framePositions[index]));
    }

    gl.useProgram(dotProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(dotProgram, "uMvp"), false, mvp);
    gl.uniform1f(gl.getUniformLocation(dotProgram, "uPointScale"), canvas.height * 0.0075);
    for (const [name, colour] of [
      ["uUnmapped", palette.unmapped],
      ["uClear", palette.clear],
      ["uPartial", palette.partial],
      ["uObstructed", palette.obstructed],
    ] as Array<[string, [number, number, number]]>) {
      gl.uniform3f(gl.getUniformLocation(dotProgram, name), colour[0], colour[1], colour[2]);
    }
    gl.uniform3f(gl.getUniformLocation(dotProgram, "uFog"), FOG[0], FOG[1], FOG[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, domeBuffer);
    const aData = gl.getAttribLocation(dotProgram, "aData");
    gl.enableVertexAttribArray(aData);
    gl.vertexAttribPointer(aData, 4, gl.FLOAT, false, 16, 0);
    if (domeVisible) gl.drawArrays(gl.POINTS, 0, domeData.length / 4);

    frameHandle = requestAnimationFrame(frame);
  }
  frameHandle = requestAnimationFrame(frame);

  return {
    setSurvey(next) {
      survey = next;
      domeData = buildDomePoints(next, trimUnmapped);
      dish = buildDish(meshForModel(next.dishModel), next, dishScale);
      dishData = dish.data;
      holdCameraClear();
      gl.bindBuffer(gl.ARRAY_BUFFER, domeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, domeData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, dishBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, dishData, gl.DYNAMIC_DRAW);
    },
    setTrimUnmapped(trim) {
      if (trim === trimUnmapped) return;
      trimUnmapped = trim;
      // The dome buffer is rebuilt on every status poll anyway, so re-cutting it
      // here costs no more than the frame that was already coming.
      domeData = buildDomePoints(survey, trimUnmapped);
      gl.bindBuffer(gl.ARRAY_BUFFER, domeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, domeData, gl.DYNAMIC_DRAW);
    },
    setSampler(sample) {
      sampleSatellites = sample;
    },
    setServing(sky) {
      servingName = sky?.name ?? null;
      if (!sky) beamTarget = null;
    },
    setTrackers(next) {
      // A dropped tracker gets one last null — the same signal the draw loop
      // sends when a satellite cannot be placed, which every consumer already
      // hides on. Without it a tracker simply goes silent and whatever it last
      // wrote to the DOM stays on screen, because React will not reset an
      // inline style it did not itself change. Matched by name, not identity:
      // the report closures are rebuilt on every effect run, so comparing
      // identity would hide trackers that are actually still live.
      for (const previous of trackers) {
        if (!next.some((tracker) => tracker.name === previous.name)) previous.report(null);
      }
      trackers = next;
    },
    getSatellite(name) {
      return frameSky.find((s) => s.name === name) ?? null;
    },
    setOnPick(pick) {
      onPick = pick;
    },
    toggleRotation() {
      return camera.toggleRotation();
    },
    isRotating() {
      return camera.isRotating();
    },
    toggleDome() {
      domeVisible = !domeVisible;
      return domeVisible;
    },
    isDomeVisible() {
      return domeVisible;
    },
    resetView() {
      camera.resetView();
    },
    dispose() {
      cancelAnimationFrame(frameHandle);
      camera.dispose();
      removeEventListener("resize", resize);
    },
  };
}
