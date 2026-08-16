// The row decides which value reaches a router that can take a house offline, so
// what is held here is the decision, not the styling: that the write carries the
// change the dialog named, and that the control still depicts the truth after it.
//
// The account lags a bypass write by minutes, and it can catch up at any moment —
// including while the dialog sits open. That timing is the source of the cases
// below, and it is why they drive `reported` by hand rather than waiting on it.

import { useState } from "react";
import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { BypassSection } from "./BypassSection";

afterEach(cleanup);

const TRACK_INSET_PX = 3;

function track(): HTMLElement {
  return document.querySelector("[data-slide-track]") as HTMLElement;
}

function handle(): HTMLElement {
  return document.querySelector("[data-slide-handle]") as HTMLElement;
}

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}

async function waitForText(substring: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (text().includes(substring)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${substring}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Lets pending state land without waiting on anything in particular. The long
 *  form outlasts the handle's glide, for the cases that measure where it stopped. */
async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type Props = React.ComponentProps<typeof BypassSection>;

function mount(overrides: Partial<Props> = {}) {
  const onSave = vi.fn<Props["onSave"]>().mockResolvedValue(undefined);
  const onReload = vi.fn();
  const props: Props = {
    reported: false,
    routerAnswering: true,
    disabled: false,
    onSave,
    onReload,
    ...overrides,
  };

  // The account's answer is a prop here, so a holder owns it and the cases move
  // it — that is how the lag is reproduced at the moment each one needs it.
  let publish: (reported: boolean | null) => void = () => {};
  function Holder() {
    const [reported, setReported] = useState(props.reported);
    publish = setReported;
    return <BypassSection {...props} reported={reported} />;
  }
  render(<Holder />);

  return { onSave, onReload, reportNow: (reported: boolean | null) => publish(reported) };
}

/** Presses the handle, crosses the whole track, and lets go. */
function slide() {
  const grip = handle();
  const start = grip.getBoundingClientRect();
  const travel = track().clientWidth - start.width - TRACK_INSET_PX * 2;
  const from = start.left + start.width / 2;
  const to = from + travel * 1.2;

  grip.setPointerCapture = () => {};
  grip.releasePointerCapture = () => {};
  grip.dispatchEvent(new PointerEvent("pointerdown", { clientX: from, bubbles: true }));
  grip.dispatchEvent(new PointerEvent("pointermove", { clientX: to, bubbles: true }));
  grip.dispatchEvent(new PointerEvent("pointerup", { clientX: to, bubbles: true }));
}

/** How far along the track the handle has been carried, 0 to 100. Where that
 *  puts it on screen is the primitive's own business, and its own test. */
function travelled(): string | null {
  return handle().getAttribute("aria-valuenow");
}

describe("BypassSection", () => {
  test("sends the change the dialog named, even when the account flips underneath it", async () => {
    const { onSave, reportNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Turn on bypass mode?");

    // The account catches up mid-decision — exactly the two-minute lag landing at
    // the worst moment. The dialog must keep asking what it asked.
    reportNow(true);
    await settle();
    expect(text()).toContain("Turn on bypass mode?");

    button("Turn on").click();
    await settle();
    expect(onSave).toHaveBeenCalledWith(true);
  });

  test("turns the control around once the write is away, so the way back starts where the handle is", async () => {
    mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Turn on bypass mode?");
    button("Turn on").click();
    await waitForText("Sent.");
    await settle();

    // Bypass now reads as on, so the track runs the other way and the spent
    // travel is cleared. Together those leave the handle at the end it reached.
    expect(text()).toContain("Slide to turn off bypass");
    expect(travelled()).toBe("0");
  });

  test("writes nothing when the dialog is dismissed, and gives the travel back", async () => {
    const { onSave } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Turn on bypass mode?");
    button("Cancel").click();
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(travelled()).toBe("0");
    expect(text()).toContain("Slide to turn on bypass");
  });

  test("holds the assumed state until the account agrees, then stops saying so", async () => {
    const { reportNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Turn on bypass mode?");
    button("Turn on").click();
    await waitForText("Sent.");

    // Assumed: the spinner stands in for the badge, because this is what was
    // asked for rather than what is known.
    expect(document.querySelector("[aria-label='Turning bypass on']")).not.toBeNull();

    reportNow(true);
    await settle();

    expect(document.querySelector("[aria-label='Turning bypass on']")).toBeNull();
    expect(text()).toContain("The Starlink router is disabled");
    expect(text()).not.toContain("Sent.");
  });

  test("reads bypass as off when the router answers, whatever the account carries", async () => {
    mount({ reported: null, routerAnswering: true });
    await waitForText("The Starlink router is running your network");
    expect(text()).toContain("Slide to turn on bypass");
  });

  test("refuses to guess a direction when nothing can say where bypass stands", async () => {
    mount({ reported: null, routerAnswering: false });
    await waitForText("Couldn't tell whether the router is bypassed");
    expect(handle().getAttribute("aria-disabled")).toBe("true");
  });

  test("names the way back when the account cannot be reached", async () => {
    mount({ reported: null, routerAnswering: false, disabled: true });
    await waitForText("Connect this device to the internet");
  });
});
