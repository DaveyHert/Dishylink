// What a rule reads as before anyone edits it.
//
// The figure is data used, and over several devices what "used" means depends on
// the mode: pooled spends one allowance between them, each-mode spends one apiece
// and the allowance is tested per device. Getting that wrong reads as a card
// contradicting itself — a total beside a limit that was never the total's.

import { expect, describe, test, afterEach } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { TooltipProvider } from "../../ui/tooltip";
import type { Rule } from "../../../hooks/useRules";
import { Dialog, DialogContent } from "../../ui/dialog";
import { RuleStatus } from "./RuleStatus";

const GB = 1_000_000_000;
const NOW = Date.now();

const member = (clientKey: string, name: string, usageBytes: number, holding = false) => ({
  clientKey,
  name,
  usageBytes,
  holding,
  paused: holding,
});

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: "kids",
    name: "Kids devices",
    memberKeys: ["1", "2", "3"],
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    mode: "perMember",
    usageBytes: 30 * GB,
    capacityBytes: 150 * GB,
    memberCount: 3,
    members: [
      member("1", "iPad", 20 * GB),
      member("2", "Console", 7 * GB),
      member("3", "Laptop", 3 * GB),
    ],
    paused: false,
    pausedCount: 0,
    reached: false,
    windowBlocked: false,
    periodEndMs: NOW + 5 * 86_400_000,
    periodStartMs: NOW - 86_400_000,
    countdownStartMs: NOW,
    createdMs: NOW,
    ...over,
  };
}

const text = () => document.body.textContent ?? "";
const show = (over: Partial<Rule> = {}) =>
  render(
    <TooltipProvider>
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <RuleStatus rule={rule(over)} candidates={[]} onEdit={() => {}} onClose={() => {}} />
        </DialogContent>
      </Dialog>
    </TooltipProvider>,
  );

describe("RuleStatus", () => {
  afterEach(cleanup);

  test("given: an each-mode group, should: meter every device on its own bar", async () => {
    // No single figure: each device has the whole allowance, so a sum is measured
    // against nothing and the largest speaks only for one of them.
    show();

    await expect.poll(text).toContain("one allowance each");
    expect(text()).toContain("50 GB each");
    // Each device reads its own share of the allowance it has to itself.
    expect(text()).toContain("40%");
    expect(text()).toContain("14%");
    expect(text()).toContain("6%");
    // The summed figure is nowhere, because nothing is measured against it.
    expect(text()).not.toContain("30 GB");
  });

  test("given: a pooled group, should: read one figure against one allowance", async () => {
    show({ mode: "pooled", usageBytes: 30 * GB, capacityBytes: 50 * GB });

    await expect.poll(text).toContain("30 GB");
    expect(text()).toContain("of 50 GB shared");
    expect(text()).toContain("sharing one allowance");
    expect(text()).toContain("Remaining");
  });

  test("given: several devices, should: list what each of them spent", async () => {
    show();

    await expect.poll(text).toContain("iPad");
    expect(text()).toContain("Console");
    expect(text()).toContain("Laptop");
    expect(text()).toContain("7 GB");
  });

  test("given: some devices held, should: name the ones actually paused", async () => {
    show({
      paused: true,
      pausedCount: 1,
      reached: true,
      members: [
        member("1", "iPad", 50 * GB, true),
        member("2", "Console", 7 * GB),
        member("3", "Laptop", 3 * GB),
      ],
    });

    await expect.poll(text).toContain("iPad is paused");
    expect(text()).toContain("the limit was reached");
  });

  test("given: a schedule, should: lead with the hours rather than an allowance", async () => {
    // A timetable is hours, not a quantity. An allowance is optional beside it and
    // is not drawn when nobody set one.
    show({
      allocationBytes: 0,
      capacityBytes: 0,
      schedule: {
        mode: "allow",
        windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 20 * 60 }],
      },
      windowEndMs: NOW + 3_600_000,
    });

    await expect.poll(text).toContain("Mon–Fri");
    expect(text()).toContain("4:00 PM – 8:00 PM");
    expect(text()).toContain("Online");
    expect(text()).not.toContain("Resets in");
    expect(text()).not.toContain("Remaining");
  });

  test("given: a schedule naming only one device, should: still say which device it is", async () => {
    // Unlike the allowance and timer views, the schedule body never draws a
    // per-device bar or figure — so the device's name has nowhere else to appear.
    show({
      memberCount: 1,
      memberKeys: ["1"],
      allocationBytes: 0,
      capacityBytes: 0,
      members: [member("1", "iPad", 0)],
      schedule: {
        mode: "allow",
        windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 20 * 60 }],
      },
      windowEndMs: NOW + 3_600_000,
    });

    await expect.poll(text).toContain("Mon–Fri");
    expect(text()).toContain("Devices");
    expect(text()).toContain("iPad");
  });

  test("given: a schedule with an allowance, should: draw the cap beneath the hours", async () => {
    show({
      mode: "pooled",
      usageBytes: 5 * GB,
      capacityBytes: 50 * GB,
      schedule: {
        mode: "allow",
        windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 20 * 60 }],
      },
      windowEndMs: NOW + 3_600_000,
    });

    await expect.poll(text).toContain("Mon–Fri");
    expect(text()).toContain("Data allowance");
    expect(text()).toContain("of 50 GB shared");
  });

  test("given: a rule, should: show when it was created", async () => {
    show({ createdMs: new Date(2026, 2, 4, 9, 15).getTime() });

    await expect.poll(text).toContain("Created");
    expect(text()).toContain("Mar 4, 2026");
  });

  test("given: a timer, should: count the clock rather than bytes", async () => {
    show({
      allocationBytes: 0,
      countdownMs: 2 * 3_600_000,
      countdownStartMs: NOW - 3_600_000,
      memberCount: 1,
      memberKeys: ["1"],
      members: [member("1", "iPad", 3 * GB)],
    });

    await expect.poll(text).toContain("of 2h");
    expect(text()).toContain("Time left");
    expect(text()).not.toContain("Resets in");
  });
});
