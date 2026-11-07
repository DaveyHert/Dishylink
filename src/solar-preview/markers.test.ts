import { afterEach, expect, it, vi } from "vitest";
import { createSkyScene } from "../components/satellite/skyScene";
import type { SatelliteSky } from "../lib/satellites";
import {
  MARKER_FRAMING_RADIUS,
  MARKER_RADIUS,
  SUN_RADIUS,
  markerMesh,
  markerPosition,
} from "./markers";

vi.mock("../components/satellite/skyCamera", () => ({
  SKY_FOV: 0.9,
  createSkyCamera: () => ({
    setMinDistance: vi.fn(),
    view: () => ({ eye: [0, 0, 8], target: [0, 0, 0] }),
    dispose: vi.fn(),
  }),
}));
vi.mock("../components/satellite/skyPrograms", () => ({
  createPrograms: () => ({
    dot: "dot",
    star: "star",
    mesh: "mesh",
    sat: "sat",
    beam: "beam",
    trail: "trail",
  }),
}));
afterEach(() => vi.unstubAllGlobals());

it("scales disk and label geometry with radius while keeping arbitrary bearings", () => {
  const angles = { azimuth: 137, elevation: 42 };
  const center = markerPosition(angles)!;
  expect(Math.hypot(...center)).toBeCloseTo(MARKER_RADIUS);
  expect((Math.atan2(center[0], -center[2]) * 180) / Math.PI).toBeCloseTo(angles.azimuth);
  expect((Math.asin(center[1] / MARKER_RADIUS) * 180) / Math.PI).toBeCloseTo(angles.elevation);
  const mesh = markerMesh(angles, { azimuth: 0, elevation: 0 }, [0, 0, 0]);
  const sunCenter = markerPosition(angles, SUN_RADIUS)!;
  expect(Math.hypot(...mesh.slice(0, 3))).toBeCloseTo(SUN_RADIUS);
  expect(MARKER_RADIUS).toBe(4);
  expect(SUN_RADIUS).toBe(4.3);
  expect(SUN_RADIUS - MARKER_RADIUS).toBeCloseTo(0.3);
  const moonMesh = markerMesh({ azimuth: 0, elevation: 0 }, angles, [0, 0, 0]);
  expect(Math.hypot(...moonMesh.slice(0, 3))).toBeCloseTo(MARKER_RADIUS);
  const distance = (offset: number) =>
    Math.hypot(...sunCenter.map((value, i) => mesh[offset + i] - value));
  expect(distance(6)).toBeCloseTo((0.055 * SUN_RADIUS) / 2);
  expect(distance(32 * 18)).toBeGreaterThan((0.08 * SUN_RADIUS) / 2);
  for (let i = 0; i < mesh.length; i += 6) {
    expect(Math.hypot(...mesh.slice(i, i + 3))).toBeLessThan(MARKER_FRAMING_RADIUS);
  }
  expect(
    markerMesh({ ...angles, elevation: 0 }, { ...angles, elevation: -1 }, [0, 0, 0]),
  ).toHaveLength(0);
});

it.each([false, true])(
  "background opt-in %s restores fog/depth and never blocks later satellites/dome",
  (background) => {
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    let program = "";
    let depthWrite = true;
    let unfogged = false;
    const draws: { program: string; depthWrite: boolean; unfogged: boolean }[] = [];
    const draw = () => draws.push({ program, depthWrite, unfogged });
    const depthTest = vi.fn();
    const gl = new Proxy<Record<string, unknown>>(
      {
        DEPTH_TEST: 2,
        enable: depthTest,
        createBuffer: () => ({}),
        getExtension: () => ({ vertexAttribDivisorANGLE: vi.fn(), drawArraysInstancedANGLE: draw }),
        getAttribLocation: () => 0,
        getUniformLocation: (_program: string, name: string) => name,
        useProgram: (value: string) => {
          program = value;
        },
        depthMask: (value: boolean) => {
          depthWrite = value;
        },
        uniform1i: (name: string, value: number) => {
          if (name === "uUnfogged") unfogged = value !== 0;
        },
        drawArrays: draw,
      },
      { get: (target, key: string) => target[key] ?? (/^[A-Z_]+$/.test(key) ? 1 : vi.fn()) },
    );
    const canvas = {
      getContext: () => gl,
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement;
    const scene = createSkyScene(
      canvas,
      {
        gridSize: 3,
        kinds: new Uint8Array(9),
        maxThetaDeg: 80,
        boresightAzimuthDeg: 0,
        boresightElevationDeg: 90,
        dishModel: "rev4Standard",
      },
      {
        stars: false,
        buildSatelliteMesh: () => ({
          positions: new Float32Array(9),
          normals: new Float32Array(9),
          colors: new Float32Array(9),
          triangleCount: 1,
        }),
        worldMarkers: () =>
          markerMesh({ azimuth: 0, elevation: 30 }, { azimuth: 0, elevation: -1 }, [0, 0, 8]),
        ...(background ? { worldMarkersBackground: true } : {}),
      },
    )!;
    // Far-range satellite shell exceeds both markers; ordering cannot depend on range.
    scene.setSampler(() => [
      { name: "far", azimuthDeg: 0, elevationDeg: 30, rangeKm: 40000 } as SatelliteSky,
    ]);
    frame(performance.now());
    expect(depthTest).toHaveBeenCalledWith(2);
    const meshes = draws.filter((draw) => draw.program === "mesh");
    expect(meshes).toHaveLength(5);
    expect(meshes.slice(0, 4).every((draw) => draw.depthWrite && !draw.unfogged)).toBe(true);
    expect(meshes[4]).toEqual({ program: "mesh", depthWrite: !background, unfogged: background });
    const satellite = draws.findIndex((draw) => draw.program === "sat");
    expect(satellite).toBeGreaterThan(draws.indexOf(meshes[4]));
    expect(draws[satellite]).toEqual({ program: "sat", depthWrite: true, unfogged: false });
    expect(draws.find((draw) => draw.program === "dot")).toEqual({
      program: "dot",
      depthWrite: true,
      unfogged: false,
    });
    scene.dispose();
  },
);
