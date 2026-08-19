// This control guards a write that takes the network down, so what matters is
// that a partial gesture does nothing: "fired at 90%" and "fired on a click" are
// the failures worth holding, not the styling.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { SlideToConfirm } from "./slide-to-confirm";

afterEach(cleanup);

const TRACK_INSET_PX = 3;

function track(): HTMLElement {
  return document.querySelector("[data-slide-track]") as HTMLElement;
}

function handle(): HTMLElement {
  return document.querySelector("[data-slide-handle]") as HTMLElement;
}

/** Rendering is not synchronous, so every case waits for the handle to exist.
 *  Polls rather than sleeps, so a passing case costs a few ms. */
async function mount(props: Partial<React.ComponentProps<typeof SlideToConfirm>> = {}) {
  const onConfirm = vi.fn();
  render(
    <div style={{ width: 420 }}>
      <SlideToConfirm
        label='Slide to turn on bypass mode'
        busyLabel='Sending…'
        onConfirm={onConfirm}
        {...props}
      />
    </div>,
  );
  const deadline = Date.now() + 2000;
  while (!handle()) {
    if (Date.now() > deadline) throw new Error("the slider never rendered");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return onConfirm;
}

let dragOrigin: number | null = null;
afterEach(() => {
  dragOrigin = null;
});

/** Drags `fraction` of the distance the handle can travel, still holding it. */
function hold(fraction: number, direction: "right" | "left" = "right") {
  const grip = handle();
  const start = grip.getBoundingClientRect();
  const travel = track().clientWidth - start.width - TRACK_INSET_PX * 2;
  const origin = dragOrigin ?? start.left + start.width / 2;
  const to = origin + travel * fraction * (direction === "right" ? 1 : -1);

  if (dragOrigin === null) {
    dragOrigin = origin;
    grip.setPointerCapture = () => {};
    grip.releasePointerCapture = () => {};
    grip.dispatchEvent(new PointerEvent("pointerdown", { clientX: origin, bubbles: true }));
  }
  grip.dispatchEvent(new PointerEvent("pointermove", { clientX: to, bubbles: true }));
  return to;
}

function release(at: number) {
  handle().dispatchEvent(new PointerEvent("pointerup", { clientX: at, bubbles: true }));
  dragOrigin = null;
}

/** A whole gesture: press, travel `fraction` of the track, let go. */
function drag(fraction: number, direction: "right" | "left" = "right") {
  release(hold(fraction, direction));
}

/** Each press waits for its render, the way separate key events arrive. */
async function press(key: string) {
  handle().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SlideToConfirm", () => {
  test("does nothing on a click, which is the gesture it exists to refuse", async () => {
    const onConfirm = await mount();
    handle().click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("does not let a bare press inherit the distance the last drag covered", async () => {
    const onConfirm = await mount();
    drag(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const grip = handle();
    grip.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, bubbles: true }));
    grip.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, bubbles: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("does not fire when the drag stops just short of the end", async () => {
    const onConfirm = await mount();
    drag(0.95);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("fires once the handle has crossed the whole track and been let go", async () => {
    const onConfirm = await mount();
    drag(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("does not fire while the handle is still held at the end", async () => {
    const onConfirm = await mount();
    hold(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("fires on the release, not on arriving at the end", async () => {
    const onConfirm = await mount();
    const at = hold(1);
    expect(onConfirm).not.toHaveBeenCalled();
    release(at);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("lets an overshoot travel back and be released harmlessly", async () => {
    const onConfirm = await mount();
    hold(1);
    const at = hold(0.4);
    release(at);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("snaps back after an incomplete drag, so the next attempt starts over", async () => {
    await mount();
    drag(0.6);
    expect(handle().getAttribute("aria-valuenow")).toBe("0");
  });

  test("runs leftward when the change goes the other way", async () => {
    const onConfirm = await mount({ direction: "left" });
    drag(1, "left");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Measured at rest on first paint, which no transition applies to. It is the
  // one place the resting geometry is pinned, so the callers can settle for
  // knowing which way their track runs.
  test("parks the handle at the end its travel starts from", async () => {
    await mount({ direction: "left" });
    const trackBox = track().getBoundingClientRect();
    const handleBox = handle().getBoundingClientRect();
    const position = (handleBox.left - trackBox.left) / (trackBox.width - handleBox.width);
    expect(position).toBeGreaterThan(0.9);
  });

  test("parks the handle at the start when the travel runs rightward", async () => {
    await mount({ direction: "right" });
    const trackBox = track().getBoundingClientRect();
    const handleBox = handle().getBoundingClientRect();
    const position = (handleBox.left - trackBox.left) / (trackBox.width - handleBox.width);
    expect(position).toBeLessThan(0.1);
  });

  test("ignores a full drag while disabled", async () => {
    const onConfirm = await mount({ disabled: true });
    drag(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("ignores a full drag while a write is already away", async () => {
    const onConfirm = await mount({ busy: true });
    drag(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("keeps the cursor answering when disabled, rather than going inert", async () => {
    await mount({ disabled: true });
    expect(getComputedStyle(track()).cursor).toBe("not-allowed");
    expect(getComputedStyle(track()).pointerEvents).not.toBe("none");
  });

  test("takes five arrow presses, so the keyboard pays the same cost as the drag", async () => {
    const onConfirm = await mount();
    handle().focus();
    for (let attempt = 0; attempt < 4; attempt++) await press("ArrowRight");
    expect(onConfirm).not.toHaveBeenCalled();
    await press("ArrowRight");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
