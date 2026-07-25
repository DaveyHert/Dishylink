// The camera's drift and the control that holds it still.
//
// Pixel-diffing the dome cannot answer this: the survey updates live, so the
// canvas keeps changing whether or not the camera is turning. This drives
// `view()` directly and reads where the eye ends up, which is the thing the
// pause button actually has to change.

import { describe, expect, it } from "vitest";
import { createSkyCamera } from "./skyCamera";

/** Steps the camera a second at a time and returns the eye's x each step. */
function driftOver(camera: ReturnType<typeof createSkyCamera>, seconds: number): number[] {
  const xs: number[] = [];
  for (let second = 1; second <= seconds; second++) {
    xs.push(camera.view(second * 1000, 1).eye[0]);
  }
  return xs;
}

function makeCamera() {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 300;
  return createSkyCamera(canvas, { onTap: () => {}, distance: 3.6 });
}

describe("sky camera rotation", () => {
  it("drifts on its own from the moment the view opens", () => {
    const camera = makeCamera();
    expect(camera.isRotating()).toBe(true);

    const xs = driftOver(camera, 4);
    // Every step lands somewhere new: the dome is turning.
    expect(new Set(xs.map((x) => x.toFixed(4))).size).toBe(xs.length);
  });

  it("holds still once rotation is toggled off, and reports it", () => {
    const camera = makeCamera();
    driftOver(camera, 2);

    expect(camera.toggleRotation()).toBe(false);
    expect(camera.isRotating()).toBe(false);

    const held = driftOver(camera, 4);
    // Inertia from the (absent) drag has long since decayed, so every step
    // reads the same eye — nothing is moving it.
    for (const x of held) expect(x).toBeCloseTo(held[0], 6);
  });

  it("picks the drift back up on the second press", () => {
    const camera = makeCamera();
    camera.toggleRotation();
    driftOver(camera, 2);

    expect(camera.toggleRotation()).toBe(true);
    expect(camera.isRotating()).toBe(true);

    const resumed = driftOver(camera, 4);
    expect(new Set(resumed.map((x) => x.toFixed(4))).size).toBe(resumed.length);
  });
});
