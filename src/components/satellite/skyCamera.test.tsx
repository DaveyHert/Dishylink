// Which way the sky turns, and when — measured, not argued. Direction bugs flip
// under reasoning, so every number below comes out of the production camera and
// the production projection; nothing is re-derived here.
//
// The reference for "which way should it turn" is the camera's OWN drag. On the
// dashboard dome, auto-rotation carries the dome the same way a rightward drag
// does (`yaw += rate` matches `yaw += dx`), which is the anti-clockwise drift
// you see there. The sky view drags the other way round (`yaw -= dx`), so its
// rotation has to be negative to agree — it was positive, and spun against both
// its own drag and the dome.

import { expect, test } from "vitest";
import { createSkyCamera } from "./skyCamera";
import { lookAt, multiply, perspective } from "./skyMath";

const WIDTH = 800,
  HEIGHT = 600;

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);
  // jsdom-free, but pointer capture still needs a stub in a detached-ish element.
  canvas.setPointerCapture = () => {};
  return canvas;
}

/** The scene's own matrix, built exactly as skyScene.frame does. */
function mvpFor(eye: number[], target: number[]) {
  return multiply(perspective(0.9, WIDTH / HEIGHT, 0.12, 90), lookAt(eye, target, [0, 1, 0]));
}

function screenX(mvp: Float32Array, p: number[]): number {
  const clipX = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
  const clipW = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
  return ((clipX / clipW) * 0.5 + 0.5) * WIDTH;
}

/**
 * The point on the horizon ring nearest the camera — the same visual reference
 * the dome offers (its near edge sits at the bottom of the frame). Orbiting the
 * camera is a rigid transform, so near and far move oppositely on screen just as
 * they do when the dome itself spins; the comparison is only meaningful if the
 * same side is watched throughout.
 */
function nearestHorizonPoint(eye: number[]): number[] {
  let best: number[] = [0, 0.06, 0];
  let bestDistance = Infinity;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const p = [Math.sin(a) * 1.16, 0.06, -Math.cos(a) * 1.16];
    const d = Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

function dragRight(canvas: HTMLCanvasElement, byPx: number) {
  const opts = { pointerId: 1, bubbles: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 400, clientY: 300 }));
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { ...opts, clientX: 400 + byPx, clientY: 300 }),
  );
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, clientX: 400 + byPx, clientY: 300 }));
  dispatchEvent(new PointerEvent("pointerup", opts));
}

test("auto-rotation carries the sky the same way a rightward drag does", () => {
  const now = performance.now();

  // 1. Which way does dragging right move the near horizon?
  const dragCanvas = makeCanvas();
  const dragCamera = createSkyCamera(dragCanvas, { onTap: () => {} });
  const start = dragCamera.view(now, 0);
  const marker = nearestHorizonPoint(start.eye);
  const beforeDrag = screenX(mvpFor(start.eye, start.target), marker);
  dragRight(dragCanvas, 40);
  const dragged = dragCamera.view(now, 0);
  const afterDrag = screenX(mvpFor(dragged.eye, dragged.target), marker);
  const dragDelta = afterDrag - beforeDrag;
  dragCamera.dispose();

  // 2. Which way does auto-rotation move it? Fresh camera, same starting pose.
  //    Rotation is on from the start, so there is nothing to switch on here.
  const spinCanvas = makeCanvas();
  const spinCamera = createSkyCamera(spinCanvas, { onTap: () => {} });
  expect(spinCamera.isRotating(), "the sky drifts until you take hold of it").toBe(true);
  const spun0 = spinCamera.view(now + 10_000, 0);
  const beforeSpin = screenX(mvpFor(spun0.eye, spun0.target), marker);
  const spun1 = spinCamera.view(now + 11_000, 1);
  const afterSpin = screenX(mvpFor(spun1.eye, spun1.target), marker);
  const spinDelta = afterSpin - beforeSpin;
  spinCamera.dispose();

  expect(Math.abs(dragDelta), "drag must actually move the view").toBeGreaterThan(1);
  expect(Math.abs(spinDelta), "auto-rotation must actually move the view").toBeGreaterThan(0.5);
  expect(
    Math.sign(spinDelta),
    `drag-right moves the near horizon by ${dragDelta.toFixed(1)}px, ` +
      `auto-rotation by ${spinDelta.toFixed(1)}px — they must agree`,
  ).toBe(Math.sign(dragDelta));
});

/** How far the eye travels in one frame at the given moment. */
function frameMotion(camera: ReturnType<typeof createSkyCamera>, at: number): number {
  const before = camera.view(at, 0.016).eye;
  const after = camera.view(at + 16, 0.016).eye;
  return Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
}

/** Drag, then run the flick inertia out, so anything still moving is rotation. */
function grabAndSettle(camera: ReturnType<typeof createSkyCamera>, canvas: HTMLCanvasElement, now: number) {
  dragRight(canvas, 40);
  for (let i = 0; i < 400; i++) camera.view(now, 0.016);
}

test("rotation yields to a grab and then picks itself back up, as the dome does", () => {
  const now = performance.now();
  const canvas = makeCanvas();
  const camera = createSkyCamera(canvas, { onTap: () => {} });
  grabAndSettle(camera, canvas, now);

  expect(frameMotion(camera, now), "rotation does not fight the angle just set").toBeLessThan(1e-6);
  expect(
    frameMotion(camera, now + 5_000),
    "rotation resumes on its own once the grab is over",
  ).toBeGreaterThan(1e-4);
  camera.dispose();
});

test("pressing play starts the rotation now, not seconds after the last grab", () => {
  const now = performance.now();
  const canvas = makeCanvas();
  const camera = createSkyCamera(canvas, { onTap: () => {} });

  // The natural gesture: look around, pause to study it, then ask for the
  // drift back. The idle delay exists to stay out of a grab's way — it must not
  // also sit on an explicit command, which reads as a dead button.
  grabAndSettle(camera, canvas, now);
  expect(camera.toggleRotation()).toBe(false);
  expect(camera.toggleRotation()).toBe(true);

  const movedNow = frameMotion(camera, now);
  expect(
    movedNow,
    `play moved the camera ${movedNow.toExponential(2)} on the next frame`,
  ).toBeGreaterThan(1e-4);
  camera.dispose();
});
