// The card is the only place a data limit is set, and every bug it has shipped
// was a state bug rather than a rendering one: a call site referencing a removed
// field, a day field that could not be typed into, and an edit that stuck. So
// what is asserted here is which face the card shows and what it will accept —
// a test that only proved the form renders would have caught none of them.

import { useState } from "react";
import { expect, describe, test, afterEach } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import type { DataMeter, MeterRuleView } from "../../hooks/useDataMeter";
import { TooltipProvider } from "../ui/tooltip";
import { DataMeterDialog } from "./DataMeterDialog";

const GB = 1_000_000_000;
const NOW = Date.now();

function rule(over: Partial<MeterRuleView> = {}): MeterRuleView {
  return {
    clientKey: "42",
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    anchorRx: 0,
    anchorTx: 0,
    observedRx: 0,
    observedTx: 0,
    periodStartMs: NOW - 86_400_000,
    periodEndMs: NOW + 5 * 86_400_000,
    actedThisCycle: false,
    pauseState: "none",
    usageBytes: 12 * GB,
    deviceName: "PS5 Console",
    ...over,
  };
}

function meter(over: Partial<DataMeter> = {}): DataMeter {
  return {
    rule: null,
    pauseEnforceable: true,
    loading: false,
    error: null,
    save: async () => {},
    restart: async () => {},
    remove: async () => {},
    ...over,
  };
}

const text = () => document.body.textContent ?? "";

/** Open state held outside the card, as the drill-in holds it, so closing and
 *  reopening is the same sequence a user performs. */
function Harness({ value }: { value: DataMeter }) {
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <button onClick={() => setOpen(true)}>reopen</button>
      <DataMeterDialog meter={value} deviceName='PS5 Console' open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  );
}

describe("DataMeterDialog", () => {
  afterEach(cleanup);

  test("given: a device with a rule, should: show what it is doing before offering to edit it", async () => {
    render(<Harness value={meter({ rule: rule() })} />);

    await expect.poll(text).toContain("GB USED");
    expect(text()).toContain("Remaining");
    expect(text()).toContain("38 GB");
    expect(text()).not.toContain("Save limit");
  });

  test("given: usage under a gigabyte, should: read the ring in MB rather than round it to 0.9", async () => {
    render(
      <Harness value={meter({ rule: rule({ usageBytes: 944_700_000, allocationBytes: GB }) })} />,
    );

    await expect.poll(text).toContain("MB USED");
    expect(text()).toContain("945");
    expect(text()).not.toContain("GB USED");
  });

  test("given: usage at a gigabyte, should: turn over to GB rather than show 1000 MB", async () => {
    render(<Harness value={meter({ rule: rule({ usageBytes: GB, allocationBytes: 5 * GB }) })} />);

    await expect.poll(text).toContain("GB USED");
    expect(text()).not.toContain("MB USED");
  });

  // The countdown and the cadence move independently: a rule five days out is
  // five days out whether it is weekly or monthly, so each holds its own tile.
  test("given: a rule with a cadence, should: report the countdown and the cadence apart", async () => {
    render(
      <Harness
        value={meter({
          rule: rule({
            cycle: { kind: "weekly", weekday: 1 },
            periodEndMs: NOW + 5 * 86_400_000,
          }),
        })}
      />,
    );

    await expect.poll(text).toContain("Resets in");
    expect(text()).toContain("5 days");
    expect(text()).toContain("Cycle");
    expect(text()).toContain("Weekly");
  });

  test("given: a one-off allowance, should: say it never resets rather than show a blank slot", async () => {
    render(
      <Harness
        value={meter({
          rule: rule({ cycle: { kind: "once" }, periodEndMs: Number.POSITIVE_INFINITY }),
        })}
      />,
    );

    await expect.poll(text).toContain("Resets in");
    expect(text()).toContain("never");
    expect(text()).toContain("One-off");
  });

  test("given: a device with no rule, should: open on the form, since there is nothing to show", async () => {
    render(<Harness value={meter({ rule: null })} />);

    await expect.poll(text).toContain("Save limit");
    expect(text()).not.toContain("GB USED");
  });

  test("given: a rule still loading, should: show neither face rather than a form of defaults", async () => {
    render(<Harness value={meter({ rule: null, loading: true })} />);

    await expect.poll(text).toContain("Data limit");
    expect(text()).not.toContain("Save limit");
    expect(text()).not.toContain("Remaining");
  });

  test("given: a paused device, should: name the allowance it reached", async () => {
    render(
      <Harness value={meter({ rule: rule({ pauseState: "applied", usageBytes: 50 * GB }) })} />,
    );

    await expect.poll(text).toContain("PAUSED");
    expect(text()).toContain("50 GB allowance");
  });

  test("given: an edit that is cancelled, should: return to the status view rather than close", async () => {
    render(<Harness value={meter({ rule: rule() })} />);

    await page.getByText("Edit limit").click();
    await expect.poll(text).toContain("Save limit");

    await page.getByText("Cancel").click();
    await expect.poll(text).toContain("GB USED");
    expect(text()).not.toContain("Save limit");
    // The card is still open: cancelling an edit steps back, it does not dismiss.
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull();
  });

  test("given: a day between 2 and 9, should: accept it — clamping every keystroke made it unreachable", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Resets on day");

    const day = [...document.querySelectorAll("input")].find(
      (input) => input.inputMode === "numeric",
    );
    expect(day).toBeTruthy();

    await page.elementLocator(day!).fill("7");
    expect(day!.value).toBe("7");
  });
});
