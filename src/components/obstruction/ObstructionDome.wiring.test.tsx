import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { DishObstructionMapJson, DishStatusJson } from "@core/dishClient";
import type { SkySceneOptions } from "../satellite/skyScene";
import { skyLighting } from "../../lib/skyLighting";
import type { ObserverLocation } from "../../lib/satellites";

let options: SkySceneOptions;
const create = vi.fn();
const dispose = vi.fn();
vi.mock("../satellite/skyScene", () => ({
  createSkyScene: (_canvas: unknown, _survey: unknown, next: SkySceneOptions) => {
    options = next;
    create();
    return { setSurvey: vi.fn(), setTrimUnmapped: vi.fn(), dispose };
  },
}));
const { ObstructionDome } = await import("./ObstructionDome");
const MAP: DishObstructionMapJson = {
  numRows: 11,
  numCols: 11,
  snr: Array.from({ length: 121 }, () => 1),
  maxThetaDeg: 80,
};
const STATUS = { boresightAzimuthDeg: 10, boresightElevationDeg: 65 } as DishStatusJson;
const LOCATION: ObserverLocation = { latitudeDeg: 0, longitudeDeg: 105, altitudeM: 0 };

test("dashboard shares celestial sky without satellites and keeps fixed camera", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-03T05:00:00Z"));
  const interval = vi.spyOn(window, "setInterval");
  const clear = vi.spyOn(window, "clearInterval");
  const view = (map: DishObstructionMapJson | null, location: ObserverLocation | null) => (
    <ObstructionDome obstructionMap={map} status={STATUS} observerLocation={location} />
  );
  const rendered = await render(view(null, LOCATION));
  try {
    expect(create).not.toHaveBeenCalled();
    expect(interval.mock.calls.some((call) => call[1] === 30_000)).toBe(false);
    await rendered.rerender(view(MAP, LOCATION));
    expect(create).toHaveBeenCalledTimes(1);
    expect(options.distance).toBe(3.6);
    expect(options.dishScale).toBe(1.5);
    expect(options.zoomable).toBe(false);
    expect(options.buildSatelliteMesh).toBeUndefined();
    expect(options.buildSatelliteMeshes).toBeUndefined();
    expect(options.worldMarkersBackground).toBe(true);
    expect(options.atmosphere!().stars).toBe(false);
    expect(options.worldMarkers!([3, 2, 3]).length).toBeGreaterThan(0);
    const index = interval.mock.calls.findIndex((call) => call[1] === 30_000);
    expect(index).toBeGreaterThanOrEqual(0);
    const refresh = interval.mock.calls[index][0] as () => void;
    now.mockReturnValue(Date.parse("2026-10-03T17:00:00Z"));
    refresh();
    expect(options.atmosphere!().stars).toBe(true);
    now.mockReturnValue(Date.parse("2026-10-03T05:00:00Z"));
    await rendered.rerender(view(MAP, { latitudeDeg: 0, longitudeDeg: -70, altitudeM: 0 }));
    expect(options.atmosphere!().stars).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    await rendered.rerender(view(MAP, null));
    expect(options.atmosphere!()).toEqual(skyLighting(-90, -90, 0));
    expect(options.worldMarkers!([3, 2, 3]).length).toBe(0);
    expect(clear).toHaveBeenCalledWith(interval.mock.results[index].value);
    await rendered.rerender(view(MAP, LOCATION));
    const lastTimer = interval.mock.results.at(-1)!.value;
    await rendered.rerender(view(null, LOCATION));
    expect(clear).toHaveBeenCalledWith(lastTimer);
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.unmount();
    now.mockRestore();
    interval.mockRestore();
    clear.mockRestore();
  }
});
