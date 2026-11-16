// The sky scene must receive its imperative wiring even when it is built in a
// LATER commit than the one that supplied that wiring.
//
// It did not, once. The scene lived in a ref, and the effects that push the
// sampler, the picker and the trackers into it named only their data as
// dependencies — never the scene — so a call made while the ref was still null
// was dropped with no second chance, and the sky rendered empty: dome dots and
// dish, no satellites, clicks dead. It recovered only when some unrelated
// dependency happened to change, which is why scrubbing the time-lapse "fixed"
// it (the scrub flips `viewingHistory`, a dependency of all four effects).
//
// The ordering below is the real one: the view opens before the dish's 30s
// obstruction poll lands, while the satellite feed is already active. The feed
// hands out `sampleSky` as a useCallback([]) — a STABLE reference for the whole
// session — so its identity never changes again to trigger a retry. Hence the
// fake holds one function across rerenders rather than making a fresh one; a
// fresh one would re-fire the effect and hide the very bug this guards.

import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { DishObstructionMapJson, DishStatusJson } from "@core/dishClient";
import type { SatelliteFeed } from "../../hooks/useSatellites";
import type { SatelliteSky } from "../../lib/satellites";
import { TooltipProvider } from "../ui/tooltip";
import type { SkySceneOptions } from "./skyScene";
import { skyLighting } from "../../lib/skyLighting";

let options: SkySceneOptions;
const calls: string[] = [];
/** What the component last handed the scene, so a test can drive it back. */
const scene: {
  trackers: Array<{
    name: string;
    report: (at: { x: number; y: number; behind: boolean } | null) => void;
  }>;
  pick: ((sky: SatelliteSky | null) => void) | null;
} = { trackers: [], pick: null };

vi.mock("./skyScene", () => ({
  createSkyScene: (_canvas: unknown, _survey: unknown, next: SkySceneOptions) => {
    options = next;
    calls.push("create");
    return {
      setSurvey: () => calls.push("setSurvey"),
      setTrimUnmapped: () => calls.push("setTrimUnmapped"),
      setSampler: (sample: unknown) => calls.push(sample ? "setSampler(fn)" : "setSampler(null)"),
      setServing: () => calls.push("setServing"),
      setTrackers: (next: typeof scene.trackers) => {
        calls.push("setTrackers");
        scene.trackers = next;
      },
      getSatellite: () => null,
      setOnPick: (pick: typeof scene.pick) => {
        calls.push(pick ? "setOnPick(fn)" : "setOnPick(null)");
        scene.pick = pick;
      },
      toggleRotation: () => true,
      isRotating: () => true,
      toggleDome: () => true,
      isDomeVisible: () => true,
      resetView: () => calls.push("resetView"),
      dispose: () => calls.push("dispose"),
    };
  },
}));

const { SatelliteView } = await import("./SatelliteView");

const GRID = 11;
const MAP: DishObstructionMapJson = {
  numRows: GRID,
  numCols: GRID,
  snr: Array.from({ length: GRID * GRID }, () => 1),
  maxThetaDeg: 80,
};
const STATUS = { boresightAzimuthDeg: 10, boresightElevationDeg: 65 } as DishStatusJson;

/** Stable for the life of the "session", exactly like the hook's useCallback([]). */
const stableSampleSky = (): SatelliteSky[] => [
  { name: "STARLINK-1234", azimuthDeg: 120, elevationDeg: 55, rangeKm: 600 },
];

/** A feed that is ALREADY active — the dish map is what arrives late here. */
const activeFeed: SatelliteFeed = {
  feedState: "active",
  errorReason: null,
  stats: {
    inViewCount: 1,
    serviceableCount: 1,
    servingCandidate: null,
    forecastMinServiceable30m: null,
    constellationSize: 1,
  },
  sampleSky: stableSampleSky,
  servingCandidateName: null,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

/** Drives the one prop change under test from inside React, as the app does. */
function Harness() {
  const [map, setMap] = useState<DishObstructionMapJson | null>(null);
  return (
    // The app mounts one provider at its root; a standalone mount has to supply
    // its own or Radix throws as soon as a tooltip renders.
    <TooltipProvider>
      <button type='button' data-testid='land-map' onClick={() => setMap(MAP)}>
        land the obstruction map
      </button>
      <SatelliteView
        obstructionMap={map}
        status={STATUS}
        satellites={activeFeed}
        observerLocation={{ latitudeDeg: 51.5, longitudeDeg: -0.12, altitudeM: 0 }}
        onLocationSaved={() => {}}
        onClearLocation={() => {}}
        onClose={() => {}}
      />
    </TooltipProvider>
  );
}

test("the scene is wired up when it is created after the wiring already existed", async () => {
  calls.length = 0;

  // Open the view before the dish's 30s obstruction poll has landed: no survey,
  // so no scene — while the satellite feed is already handing out its sampler.
  render(<Harness />);
  await settle();
  expect(calls, "no scene can exist without a survey").not.toContain("create");

  // The map lands. The scene is built now, in a commit of its own.
  document.querySelector<HTMLButtonElement>("[data-testid='land-map']")!.click();
  await settle();
  expect(calls).toContain("create");

  // Everything the scene needs to draw satellites was available the whole time.
  expect(calls, `calls seen: ${calls.join(", ")}`).toContain("setSampler(fn)");
  expect(calls, `calls seen: ${calls.join(", ")}`).toContain("setOnPick(fn)");
});

// The ring is a selection marker, so it has to ride the satellite that was
// tapped. It once lived inside the serving satellite's name-tag element, which
// is positioned by a different tracker — so tapping anything put the ring on the
// serving satellite instead. Two subjects, two elements, two trackers.
const SERVING: SatelliteSky = {
  name: "STARLINK-AAA",
  azimuthDeg: 10,
  elevationDeg: 70,
  rangeKm: 550,
};
const TAPPED: SatelliteSky = {
  name: "STARLINK-BBB",
  azimuthDeg: 200,
  elevationDeg: 40,
  rangeKm: 700,
};

test("the selection ring marks the satellite you tapped, not the serving one", async () => {
  calls.length = 0;
  scene.trackers = [];
  scene.pick = null;

  render(
    <TooltipProvider>
      <SatelliteView
        obstructionMap={MAP}
        status={STATUS}
        satellites={{
          feedState: "active",
          errorReason: null,
          stats: {
            inViewCount: 2,
            serviceableCount: 2,
            servingCandidate: SERVING,
            forecastMinServiceable30m: null,
            constellationSize: 2,
          },
          sampleSky: () => [SERVING, TAPPED],
          servingCandidateName: SERVING.name,
        }}
        observerLocation={{ latitudeDeg: 51.5, longitudeDeg: -0.12, altitudeM: 0 }}
        onLocationSaved={() => {}}
        onClearLocation={() => {}}
        onClose={() => {}}
      />
    </TooltipProvider>,
  );
  await settle();

  expect(scene.pick, "the scene can report taps").toBeTruthy();
  scene.pick!(TAPPED);
  await settle();

  // Report the serving one FIRST: if the ring rode that tracker it would end up
  // here, and the assertion below would catch it.
  const report = (name: string, x: number, y: number) => {
    for (const tracker of scene.trackers) {
      if (tracker.name === name) tracker.report({ x, y, behind: false });
    }
  };
  report(SERVING.name, 50, 60);
  report(TAPPED.name, 300, 200);

  const ring = document.querySelector<HTMLElement>("[data-slot='satellite-selection-ring']");
  expect(ring, "a tapped satellite gets a ring").toBeTruthy();
  expect(
    ring!.style.transform,
    "the ring sits on the tapped satellite, not the serving one at 50,60",
  ).toBe("translate(300px, 200px)");
  expect(ring!.style.display).toBe("block");
});

test("celestial clock refreshes every 30 seconds, responds to coordinates, and cleans up", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-03T05:00:00Z"));
  const interval = vi.spyOn(window, "setInterval");
  const clear = vi.spyOn(window, "clearInterval");
  const props = {
    obstructionMap: MAP,
    status: STATUS,
    satellites: activeFeed,
    observerLocation: { latitudeDeg: 0, longitudeDeg: 105, altitudeM: 0 },
    onLocationSaved: () => {},
    onClearLocation: () => {},
    onClose: () => {},
  };
  const view = (location: typeof props.observerLocation | null) => (
    <TooltipProvider>
      <SatelliteView {...props} observerLocation={location} />
    </TooltipProvider>
  );
  const rendered = await render(view(props.observerLocation));
  try {
    await settle();
    expect(options.worldMarkersBackground).toBe(true);
    expect(options.framingRadius).toBe(4.7);
    expect(options.atmosphere!().stars).toBe(false);
    const index = interval.mock.calls.findIndex((call) => call[1] === 30_000);
    expect(index).toBeGreaterThanOrEqual(0);
    const refresh = interval.mock.calls[index][0] as () => void;
    now.mockReturnValue(Date.parse("2026-10-03T17:00:00Z"));
    refresh();
    expect(options.atmosphere!().stars).toBe(true);
    const createCount = calls.filter((call) => call === "create").length;
    now.mockReturnValue(Date.parse("2026-10-03T05:00:00Z"));
    await rendered.rerender(view({ latitudeDeg: 0, longitudeDeg: -70, altitudeM: 0 }));
    expect(options.atmosphere!().stars).toBe(true);
    expect(calls.filter((call) => call === "create").length).toBe(createCount);
    await rendered.rerender(view(null));
    expect(options.atmosphere!()).toEqual(skyLighting(-90, -90, 0));
    expect(options.worldMarkers!([3, 2, 3]).length).toBe(0);
    expect(clear).toHaveBeenCalledWith(interval.mock.results[index].value);
    await rendered.rerender(view(props.observerLocation));
    const lastTimer = interval.mock.results.at(-1)!.value;
    await rendered.unmount();
    expect(clear).toHaveBeenCalledWith(lastTimer);
  } finally {
    now.mockRestore();
    interval.mockRestore();
    clear.mockRestore();
  }
});
