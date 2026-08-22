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
    dishPresence: "absent",
    disabled: false,
    accountAnswering: true,
    onSave,
    onReload,
    ...overrides,
  };

  // The account's answer is a prop here, so a holder owns it and the cases move
  // it — that is how the lag is reproduced at the moment each one needs it.
  let publish: (reported: boolean | null) => void = () => {};
  // The dish's answer moves independently of the account's, and the point of
  // several cases is that it arrives first.
  let publishObserved: (patch: Partial<Props>) => void = () => {};
  function Holder() {
    const [reported, setReported] = useState(props.reported);
    const [observed, setObserved] = useState<Partial<Props>>({});
    publish = setReported;
    publishObserved = (patch) => setObserved((held) => ({ ...held, ...patch }));
    return <BypassSection {...props} reported={reported} {...observed} />;
  }
  render(<Holder />);

  return {
    onSave,
    onReload,
    reportNow: (reported: boolean | null) => publish(reported),
    observeNow: (patch: Partial<Props>) => publishObserved(patch),
  };
}

/** Presses the handle, crosses the whole track, and lets go. */
function slide() {
  const grip = handle();
  const start = grip.getBoundingClientRect();
  const rail = track().getBoundingClientRect();
  const travel = track().clientWidth - start.width - TRACK_INSET_PX * 2;
  const from = start.left + start.width / 2;
  // A track offering "off" runs the other way, with the handle parked at its end.
  const rightward = start.left - rail.left <= rail.width / 2;
  const to = rightward ? from + travel * 1.2 : from - travel * 1.2;

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
    await waitForText("Are you sure?");

    // The account catches up mid-decision — exactly the two-minute lag landing at
    // the worst moment. The dialog must keep asking what it asked.
    reportNow(true);
    await settle();
    expect(text()).toContain("will switch off");

    button("Turn on").click();
    await settle();
    expect(onSave).toHaveBeenCalledWith(true);
  });

  test("turns the control around once the write is away, so the way back starts where the handle is", async () => {
    mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
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
    await waitForText("Are you sure?");
    button("Cancel").click();
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(travelled()).toBe("0");
    expect(text()).toContain("Slide to turn on bypass");
  });

  test("holds the assumed state until the account agrees, then stops saying so", async () => {
    const { reportNow, observeNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");

    // Assumed: the spinner stands in for the badge, because this is what was
    // asked for rather than what is known.
    expect(document.querySelector("[aria-label='Turning bypass on']")).not.toBeNull();

    // Bypass silences the router on the LAN, so the account agreeing while it
    // still answers is a state the hardware cannot be in.
    observeNow({ routerAnswering: false });
    reportNow(true);
    await settle();

    expect(document.querySelector("[aria-label='Turning bypass on']")).toBeNull();
    expect(text()).toContain("The Starlink router is disabled");
    expect(text()).not.toContain("Sent.");
  });

  test("settles on the dish rather than waiting out the account", async () => {
    // A bypassed router stops uploading telemetry, so the account can sit on the
    // old value until the wait times out. The dish names the role in seconds.
    const { observeNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");

    // The account is left saying the old thing, exactly as it does on hardware.
    observeNow({ dishPresence: "bypassed", routerAnswering: false });
    await settle();

    expect(document.querySelector("[aria-label='Turning bypass on']")).toBeNull();
    expect(text()).toContain("The Starlink router is disabled");
  });

  test("takes the dish's word even in the pass that loses the account", async () => {
    const { observeNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");

    // Both arrive together: the confirmation settles it, so the unreachable
    // account is no longer worth a word.
    observeNow({ dishPresence: "bypassed", routerAnswering: false, accountAnswering: false });
    await settle();

    expect(text()).toContain("The Starlink router is disabled");
    expect(text()).not.toContain("can't reach your Starlink account");
    expect(text()).not.toContain("Sent.");
  });

  test("refuses the opposite write while the first is still unresolved", async () => {
    const { onSave } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);

    // The row now offers "off", but the "on" it just sent has not landed. Sending
    // the opposite into that window races two writes at one router.
    expect(handle().getAttribute("aria-disabled")).toBe("true");
    slide();
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("believes the router answering over an account still reporting bypass", async () => {
    // On hardware the WiFi was back and the machine was on it while the account
    // still said bypassed. The row sat on `On` for four minutes because the
    // slowest signal outranked the one that had just proved itself.
    const { observeNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");

    // The account catches up, so the assumption is spent and the row reads it.
    observeNow({ routerAnswering: false, dishPresence: "bypassed" });
    await settle();
    expect(text()).toContain("The Starlink router is disabled");

    // The router comes back on the LAN. The account has not caught up yet.
    observeNow({ routerAnswering: true, dishPresence: "bypassed" });
    await settle();
    expect(text()).toContain("The Starlink router is running your network");
  });

  test("ends the wait on the dish dropping the bypassed role, not on the account", async () => {
    // Hardware: the WiFi was back and the dish said so, while the account still
    // reported bypass and held the row on `On` for four minutes.
    const { observeNow } = mount({
      reported: true,
      routerAnswering: false,
      dishPresence: "bypassed",
    });
    await waitForText("Slide to turn off bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn off").click();
    await waitForText("Sent!");

    observeNow({ dishPresence: "present" });
    await settle();

    expect(document.querySelector("[aria-label='Turning bypass off']")).toBeNull();
    expect(text()).toContain("The Starlink router is running your network");
  });

  test("reads bypass as off when the router answers, whatever the account carries", async () => {
    mount({ reported: null, routerAnswering: true });
    await waitForText("The Starlink router is running your network");
    expect(text()).toContain("Slide to turn on bypass");
  });

  test("offers the way back when nothing can say where bypass stands", async () => {
    const { onSave } = mount({ reported: null, routerAnswering: false });
    await waitForText("Couldn't tell whether the router is bypassed");
    expect(handle().getAttribute("aria-disabled")).not.toBe("true");
    expect(text()).toContain("Slide to turn off bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn off").click();
    await settle();
    expect(onSave).toHaveBeenCalledWith(false);
  });

  test("stops waiting on an account that turning bypass on has put out of reach", async () => {
    // The confirmation rides the network the write tears down.
    const { observeNow } = mount({ reported: false });
    await waitForText("Slide to turn on bypass");

    slide();
    await waitForText("Are you sure?");
    button("Turn on").click();
    await waitForText("Sent.");
    expect(document.querySelector("[aria-label='Turning bypass on']")).not.toBeNull();

    observeNow({ accountAnswering: false, routerAnswering: false });
    await waitForText("can't reach your Starlink account");

    // The spinner stops without unlearning the write, so the way back is offered.
    expect(document.querySelector("[aria-label='Turning bypass on']")).toBeNull();
    expect(handle().getAttribute("aria-disabled")).not.toBe("true");
    expect(text()).toContain("Slide to turn off bypass");
    expect(text()).toContain("The Starlink router is disabled");
  });

  test("names the way back when the account cannot be reached", async () => {
    mount({ reported: null, routerAnswering: false, disabled: true });
    await waitForText("Connect this device to the internet");
  });
});
