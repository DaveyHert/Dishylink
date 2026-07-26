// Orbit camera and pointer handling for the sky view.
//
// Owns where the viewer is and how input moves them: yaw/pitch/zoom, the flick
// inertia after a drag, the auto-rotation, and the listeners feeding all of it.
// The scene asks for an eye position once per frame and otherwise leaves it
// alone.
//
// Deliberately does NOT own picking. Deciding *what* was clicked needs this
// frame's satellites and matrix, which live with the scene — so the camera only
// answers the question it can: was that press a tap, or the start of an orbit
// drag? It reports taps and lets the scene resolve them.

/** One turn every two minutes: present when you look at it, never the thing
 *  moving in the corner of your eye. Both domes drift at this rate. */
const AUTO_ROTATE_RAD_PER_SEC = (2 * Math.PI) / 120;
/** Rotation yields after a drag, so it isn't fighting the angle you just set —
 *  just long enough to feel like letting go, not like the view stalling. */
const RESUME_AFTER_DRAG_MS = 1_000;
/** A reset drifts back at a slow, cinematic pace rather than snapping — long
 *  enough to read as a camera pulling out, not a jump cut. */
const RESET_SECONDS = 2.4;

export interface SkyCameraOptions {
  /** A press that did not turn into an orbit drag, in client coordinates.
   *  Omitted where there is nothing to pick, as on the dashboard card. */
  onTap?: (clientX: number, clientY: number) => void;
  /** Where the viewer starts. The card frames the dome at a fixed distance;
   *  the full view opens here and lets you zoom from it. */
  distance?: number;
  /** Whether the wheel zooms. False on the card, which holds one framing — the
   *  listener is then never attached, so the page scrolls over it normally. */
  zoomable?: boolean;
}

export interface SkyCameraView {
  eye: number[];
  target: number[];
}

export interface SkyCamera {
  /** Advance inertia and auto-rotation, then hand back this frame's view. */
  view(now: number, dt: number): SkyCameraView;
  /** Returns the new state, so a button can render the right icon. */
  toggleRotation(): boolean;
  /** Whether rotation is on, so a button can seed its icon from the truth
   *  rather than from a guess about this module's default. */
  isRotating(): boolean;
  /** Gently ease the tilt and zoom back to the opening framing, leaving the
   *  heading you are looking along untouched. Yields at once to a drag or wheel. */
  resetView(): void;
  /**
   * Keep the eye this far out, on top of the usual floor. A body the viewer can
   * zoom inside — an aircraft, not a panel — asks for its own radius here, or the
   * near wall clips away and you find yourself looking at its interior.
   *
   * Only raises the floor, never lowers it: a model smaller than the standing
   * minimum leaves the zoom exactly as it was.
   */
  setMinDistance(distance: number): void;
  dispose(): void;
}

/** Far enough back to hold the whole dome, tilted slightly above the horizon. */
const INITIAL = { yaw: 2.6, pitch: 0.34, distance: 4.3 };
/** Pitch stops short of both poles, where the up vector degenerates. */
const PITCH_MIN = 0.03,
  PITCH_MAX = 1.35;
const DISTANCE_MIN = 0.45,
  DISTANCE_MAX = 5.5;
/**
 * The orbit focus descends as the viewer zooms in. Far out, it sits high (0.42)
 * to frame the whole dome; up close it drops to the dish, which rests on the
 * ground near y≈0.1 — without this the near view closes on a point above the
 * dish and flies over it. Interpolated by distance between here and FOCUS_FAR.
 */
const TARGET_Y_FAR = 0.42,
  TARGET_Y_NEAR = 0.13,
  FOCUS_FAR = 3.0;
/** Movement beyond this many pixels is an orbit, not a tap. */
const TAP_SLOP = 4;

export function createSkyCamera(
  canvas: HTMLCanvasElement,
  { onTap, distance: initialDistance, zoomable = true }: SkyCameraOptions,
): SkyCamera {
  let { yaw, pitch } = INITIAL;
  let distance = initialDistance ?? INITIAL.distance;
  // Raised only by a model that needs clearance; DISTANCE_MIN still governs
  // everything else.
  let modelFloor = 0;
  const floor = () => Math.max(DISTANCE_MIN, modelFloor);
  // The opening framing — the tilt and distance the camera first sat at above the
  // dome, captured so a reset can return to it whatever this scene was built with.
  const home = { pitch, distance };
  // While a reset glides, the tilt and zoom it is easing between; cleared the
  // instant the viewer takes hold again, so it never fights a drag or wheel.
  let resetTo: {
    fromPitch: number;
    toPitch: number;
    fromDist: number;
    toDist: number;
    t: number; // 0 → 1 over RESET_SECONDS
  } | null = null;
  // On from the moment the view opens, as on the dashboard dome: the sky drifts
  // until you take hold of it, and picks the drift back up once you let go.
  // The pause control turns it off for anyone who would rather it held still.
  let autoRotate = true;
  let dragging = false,
    lastX = 0,
    lastY = 0,
    velocity = 0,
    // Nothing has been touched yet, so nothing is owed a pause: rotation starts
    // with the view rather than RESUME_AFTER_DRAG_MS into the page's life.
    lastInteraction = Number.NEGATIVE_INFINITY;
  let pressAt: { x: number; y: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    resetTo = null;
    lastX = e.clientX;
    lastY = e.clientY;
    velocity = 0;
    canvas.setPointerCapture(e.pointerId);
    lastInteraction = performance.now();
    pressAt = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX,
      dy = e.clientY - lastY;
    yaw -= dx * 0.005;
    velocity = -dx * 0.005;
    pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch + dy * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
    lastInteraction = performance.now();
  };
  const onPointerUp = () => {
    dragging = false;
  };
  // A click is a press that did not turn into an orbit drag.
  const onCanvasPointerUp = (e: PointerEvent) => {
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    pressAt = null;
    if (moved > TAP_SLOP) return;
    onTap?.(e.clientX, e.clientY);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    resetTo = null;
    distance = Math.min(DISTANCE_MAX, Math.max(floor(), distance + e.deltaY * 0.0035));
    lastInteraction = performance.now();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointermove", onPointerMove);
  // On window, not the canvas: a drag that ends outside the canvas still has to
  // stop the orbit, or the camera keeps following the pointer.
  addEventListener("pointerup", onPointerUp);
  // Only bound when zooming is offered: this handler calls preventDefault, so
  // attaching it to a fixed-framing canvas would swallow the page's scroll.
  if (zoomable) canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    view(now, dt) {
      if (!dragging) {
        yaw += velocity;
        velocity *= 0.94;
        if (autoRotate && now - lastInteraction > RESUME_AFTER_DRAG_MS) {
          // Minus, to match the drag directly above: `yaw -= dx` is what sends a
          // rightward drag this way, so rotation continues the gesture instead
          // of undoing it. The dashboard dome turns anti-clockwise for exactly
          // this reason — there, rotation and drag share a sign too — and the
          // two views have to turn the same way.
          yaw -= dt * AUTO_ROTATE_RAD_PER_SEC;
        }
      }
      if (resetTo) {
        // Ease the tilt and zoom back to the opening framing over RESET_SECONDS —
        // the camera's starting angle and distance above the dome, never the
        // heading it began at. A slow cosine in-out, so it starts and stops like
        // a camera settling; the heading drifts on above it, untouched.
        resetTo.t = Math.min(1, resetTo.t + dt / RESET_SECONDS);
        const e = 0.5 - 0.5 * Math.cos(Math.PI * resetTo.t);
        pitch = resetTo.fromPitch + (resetTo.toPitch - resetTo.fromPitch) * e;
        distance = resetTo.fromDist + (resetTo.toDist - resetTo.fromDist) * e;
        if (resetTo.t >= 1) resetTo = null;
      }
      const zoomedOut = Math.min(
        1,
        Math.max(0, (distance - DISTANCE_MIN) / (FOCUS_FAR - DISTANCE_MIN)),
      );
      const targetY = TARGET_Y_NEAR + (TARGET_Y_FAR - TARGET_Y_NEAR) * zoomedOut;
      const target = [0, targetY, 0];
      return {
        target,
        eye: [
          target[0] + distance * Math.cos(pitch) * Math.sin(yaw),
          target[1] + distance * Math.sin(pitch),
          target[2] + distance * Math.cos(pitch) * Math.cos(yaw),
        ],
      };
    },
    toggleRotation() {
      autoRotate = !autoRotate;
      // Pressing play is a command, not a lull. The idle delay is there so
      // rotation does not fight the angle you just dragged to — there is no
      // drag to yield to here, and sitting out the delay reads as a dead button.
      if (autoRotate) lastInteraction = Number.NEGATIVE_INFINITY;
      return autoRotate;
    },
    isRotating() {
      return autoRotate;
    },
    setMinDistance(next: number) {
      modelFloor = next;
      // Push the eye out if it is already inside the new floor — switching to a
      // bigger body mid-view would otherwise leave the camera stranded within it
      // until the next scroll.
      if (distance < floor()) distance = floor();
    },
    resetView() {
      // Only the tilt and zoom return to where the view opened; the heading you
      // are looking along is left exactly where it is. Captured from where the
      // camera is now, so pressing it again mid-glide simply re-eases from here.
      resetTo = {
        fromPitch: pitch,
        toPitch: home.pitch,
        fromDist: distance,
        toDist: home.distance,
        t: 0,
      };
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onCanvasPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      if (zoomable) canvas.removeEventListener("wheel", onWheel);
    },
  };
}
