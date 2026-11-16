import { afterEach, expect, it, vi } from "vitest";
import type { SatelliteSky } from "../../lib/satellites";
import { createSkyScene, type ScreenPoint } from "./skyScene";
import { buildSatelliteModels, resolveSatelliteModel } from "./satelliteModels";

const camera = vi.hoisted(() => ({
  tap: undefined as undefined | ((x: number, y: number) => void),
}));
vi.mock("./skyCamera", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./skyCamera")>()),
  createSkyCamera: (_canvas: unknown, options: { onTap?: (x: number, y: number) => void }) => {
    camera.tap = options.onTap;
    return {
      setMinDistance: vi.fn(),
      view: () => ({ eye: [0, 0, 8], target: [0, 0, 0] }),
      dispose: vi.fn(),
      isRotating: () => false,
    };
  },
}));
vi.mock("./skyPrograms", () => ({
  createPrograms: () => ({ dot: {}, star: {}, mesh: {}, sat: {}, beam: {}, trail: {} }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
});

it("draws grouped meshes with aligned transforms/colors, preserves picking identity, frees GPU objects", () => {
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
  const created: object[] = [];
  const deleted: object[] = [];
  let bound: object;
  const uploads = new Map<object, Float32Array>();
  const attributes = new Map<string, object>();
  const draws: { count: number; instances: number; offset: Float32Array; color: Float32Array }[] =
    [];
  const extension = {
    vertexAttribDivisorANGLE: vi.fn(),
    drawArraysInstancedANGLE: (_mode: number, _start: number, count: number, instances: number) => {
      draws.push({
        count,
        instances,
        offset: uploads.get(attributes.get("iOffset")!)!,
        color: uploads.get(attributes.get("aColor")!)!,
      });
    },
  };
  const functions: Record<string, unknown> = {
    getExtension: () => extension,
    createBuffer: () => {
      const b = {};
      created.push(b);
      return b;
    },
    bindBuffer: (_target: number, b: object) => {
      bound = b;
    },
    bufferData: (_target: number, data: Float32Array) => uploads.set(bound, data.slice()),
    bufferSubData: (_target: number, _offset: number, data: Float32Array) =>
      uploads.set(bound, data.slice()),
    getAttribLocation: (_program: object, name: string) => name,
    vertexAttribPointer: (name: string) => attributes.set(name, bound),
    deleteBuffer: (b: object) => deleted.push(b),
    deleteProgram: vi.fn(),
  };
  const gl = new Proxy(functions, {
    get: (target, key: string) => target[key] ?? (/^[A-Z_]+$/.test(key) ? 1 : vi.fn()),
  });
  const canvas = {
    getContext: () => gl,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  const models = buildSatelliteModels();
  const scene = createSkyScene(
    canvas,
    {
      gridSize: 3,
      kinds: new Uint8Array(9),
      maxThetaDeg: 80,
      boresightAzimuthDeg: 0,
      boresightElevationDeg: 90,
      dishModel: "rev3Rectangular",
    },
    {
      stars: false,
      buildSatelliteMeshes: () => models,
      satelliteModel: (sat) => resolveSatelliteModel(sat.hardwareVersion),
    },
  )!;
  const sample = ["V2 Mini", undefined, "V3", "V1.5", "V2 Mini DTC"].map(
    (hardwareVersion, index) =>
      ({
        name: `sat-${index}`,
        hardwareVersion,
        azimuthDeg: index * 60,
        elevationDeg: 50,
        rangeKm: 550,
      }) as SatelliteSky,
  );
  scene.setSampler(() => sample);
  const points = new Map<string, ScreenPoint>();
  scene.setTrackers(
    sample.map((sat) => ({
      name: sat.name,
      report: (point) => {
        if (point) points.set(sat.name, point);
      },
    })),
  );
  frame(performance.now());
  expect(draws.map((draw) => draw.instances)).toEqual([1, 1, 2, 1]);
  Object.values(models).forEach((mesh, index) => {
    expect(draws[index].count).toBe(mesh.triangleCount * 3);
    expect(draws[index].color).toEqual(mesh.colors);
  });
  const radius = 2 * 1.12;
  expect(draws[0].offset[0]).toBeCloseTo(
    Math.cos((50 * Math.PI) / 180) * Math.sin(Math.PI / 3) * radius,
  );
  expect(draws[2].offset[0]).toBeCloseTo(0);
  expect(draws[2].offset[3]).toBeCloseTo(
    Math.cos((50 * Math.PI) / 180) * Math.sin((240 * Math.PI) / 180) * radius,
  );
  const picked = vi.fn();
  scene.setOnPick(picked);
  const point = points.get("sat-1")!;
  camera.tap!(point.x, point.y);
  expect(picked).toHaveBeenCalledWith(sample[1]);
  expect(scene.getSatellite("sat-2")).toBe(sample[2]);
  scene.setSampler(null);
  draws.length = 0;
  frame(performance.now());
  expect(draws).toHaveLength(0);
  expect(scene.getSatellite("sat-2")).toBeNull();
  scene.dispose();
  expect(new Set(deleted)).toEqual(new Set(created));
  expect(functions.deleteProgram).toHaveBeenCalledTimes(6);
});
