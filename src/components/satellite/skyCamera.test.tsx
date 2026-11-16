// The camera's drift and the control that holds it still.
//
// Pixel-diffing the dome cannot answer this: the survey updates live, so the
// canvas keeps changing whether or not the camera is turning. This drives
// `view()` directly and reads where the eye ends up, which is the thing the
// pause button actually has to change.

import { describe, expect, it } from "vitest";
import { createSkyCamera, skyFramingDistance, SKY_FOV } from "./skyCamera";
import { lookAt, multiply, perspective } from "./skyMath";
import { MARKER_FRAMING_RADIUS, markerMesh } from "./celestialMarkers";

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

describe("sky camera zoom-out framing", () => {
  it.each([undefined, MARKER_FRAMING_RADIUS])("wheel respects opt-in bound %s", (framingRadius) => {
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    const camera = createSkyCamera(canvas, { framingRadius });
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100000 }));
    const { eye, target } = camera.view(0, 0);
    expect(Math.hypot(...eye.map((v, i) => v - target[i]))).toBeCloseTo(
      framingRadius === undefined ? 5.5 : skyFramingDistance(framingRadius, 800 / 600),
    );
    camera.dispose();
  });

  it.each([0.5, 1, 16 / 9])("fits disks and labels across shell at aspect %s", (aspect) => {
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, {
      clientWidth: { value: 600 * aspect },
      clientHeight: { value: 600 },
    });
    const camera = createSkyCamera(canvas, { framingRadius: MARKER_FRAMING_RADIUS });
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100000 }));
    const { eye, target } = camera.view(0, 0);
    const mvp = multiply(perspective(SKY_FOV, aspect, 0.12, 90), lookAt(eye, target, [0, 1, 0]));
    for (let azimuth = 0; azimuth < 360; azimuth += 15) {
      for (const elevation of [0.1, 30, 60, 90]) {
        const mesh = markerMesh({ azimuth, elevation }, { azimuth, elevation }, eye);
        for (let i = 0; i < mesh.length; i += 6) {
          const point = [mesh[i], mesh[i + 1], mesh[i + 2], 1];
          const clip = [0, 1, 2, 3].map((row) =>
            point.reduce((sum, v, col) => sum + mvp[col * 4 + row] * v, 0),
          );
          expect(clip[3]).toBeGreaterThan(0);
          for (const value of clip.slice(0, 3)) expect(Math.abs(value / clip[3])).toBeLessThan(1);
        }
      }
    }
    camera.dispose();
  });
});

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
