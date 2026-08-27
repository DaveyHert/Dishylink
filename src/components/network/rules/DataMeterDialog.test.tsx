// The card is the only place a data limit is set, and every bug it has shipped
// was a state bug rather than a rendering one: a call site referencing a removed
// field, a day field that could not be typed into, and an edit that stuck. So
// what is asserted here is which face the card shows and what it will accept —
// a test that only proved the form renders would have caught none of them.

import { useState } from "react";
import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { DeviceGroup } from "@core/deviceGroup";
import type { DataMeter, MeterRuleView } from "../../../hooks/useDataMeter";
import { TooltipProvider } from "../../ui/tooltip";
import { DataMeterDialog } from "./DataMeterDialog";

let heldGroups: DeviceGroup[] = [];
const groupsSaved: { memberKeys: string[]; groupId?: string }[] = [];
const groupsRemoved: string[] = [];
const deviceRulesRemoved: string[] = [];

vi.mock("../../../hooks/useDataMeter", () => ({
  removeDeviceRule: async (clientKey: string) => {
    deviceRulesRemoved.push(clientKey);
  },
}));

vi.mock("../../../hooks/useDeviceGroups", () => ({
  useDeviceGroups: () => ({
    groups: heldGroups,
    pauseEnforceable: true,
    loading: false,
    error: null,
    save: async (terms: { memberKeys: string[]; groupId?: string }) => {
      groupsSaved.push({ memberKeys: terms.memberKeys, groupId: terms.groupId });
    },
    remove: async (groupId: string) => {
      groupsRemoved.push(groupId);
    },
  }),
}));

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
    createdMs: NOW,
    pauseState: "none",
    holding: false,
    usageBytes: 12 * GB,
    ownUsageBytes: 12 * GB,
    reached: false,
    deviceName: "PS5 Console",
    ...over,
  };
}

function meter(over: Partial<DataMeter> = {}): DataMeter {
  const held = over.rule === undefined || over.rule === null ? [] : [over.rule];
  return {
    rules: held,
    rule: null,
    pauseEnforceable: true,
    loading: false,
    error: null,
    save: async () => {},
    restart: async () => {},
    remove: async () => {},
    reload: async () => {},
    ...over,
  };
}

const text = () => document.body.textContent ?? "";

/** Open state held outside the card, as the drill-in holds it, so closing and
 *  reopening is the same sequence a user performs. */
const CANDIDATES = [
  {
    clientKey: "42",
    name: "PS5 Console",
    macAddress: "aa:bb:cc:00:00:01",
    active: true,
    lastSeenMs: NOW,
  },
  // Away right now, and still pickable: a rule on an absent device rolls its
  // cycle and releases its pause the same as one on a device that is here.
  {
    clientKey: "43",
    name: "Kids iPad",
    macAddress: "aa:bb:cc:00:00:02",
    active: false,
    lastSeenMs: NOW - 86_400_000,
  },
];

function Harness({ value }: { value: DataMeter }) {
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <button onClick={() => setOpen(true)}>reopen</button>
      <DataMeterDialog
        meter={value}
        clientKey='42'
        deviceName='PS5 Console'
        macAddress='aa:bb:cc:00:00:01'
        candidates={CANDIDATES}
        open={open}
        onOpenChange={setOpen}
      />
    </TooltipProvider>
  );
}

describe("DataMeterDialog", () => {
  afterEach(() => {
    cleanup();
    heldGroups = [];
    groupsSaved.length = 0;
    groupsRemoved.length = 0;
    deviceRulesRemoved.length = 0;
  });

  test("given: this device's own rule widened to a second device, should: take the first rule with it", async () => {
    // Left standing, it goes on holding this device against a limit the group's
    // card never shows — and it counts from its own anchors, not the group's.
    render(<Harness value={meter({ rule: rule() })} />);
    await expect.poll(text).toContain("Edit limit");
    await page.getByRole("button", { name: "Edit limit" }).click();

    await page.getByRole("button", { name: "This device" }).click();
    await page.getByText("Kids iPad").click();
    await page.getByRole("button", { name: "Save limit for all" }).click();

    await expect.poll(() => groupsSaved).toHaveLength(1);
    expect(groupsSaved[0].memberKeys).toEqual(["42", "43"]);
    expect(deviceRulesRemoved).toEqual(["42"]);
  });

  test("given: a device with a rule, should: show what it is doing before offering to edit it", async () => {
    render(<Harness value={meter({ rule: rule() })} />);

    await expect.poll(text).toContain("GB USED");
    expect(text()).toContain("Remaining");
    expect(text()).toContain("38 GB");
    expect(text()).not.toContain("Save limit");
    expect(text()).toContain("Created");
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

  test("given: Start over, should: show the cycle it just restarted rather than stay in the form", async () => {
    const restarted: string[] = [];
    render(
      <Harness
        value={meter({ rule: rule(), restart: async () => void restarted.push("reset") })}
      />,
    );

    await page.getByText("Edit limit").click();
    await expect.poll(text).toContain("Save limit");

    await page.getByText("Start over").click();

    await expect.poll(text).toContain("GB USED");
    expect(restarted).toEqual(["reset"]);
    expect(text()).not.toContain("Save limit");
  });

  test("given: the Timer chip, should: swap the allowance for a countdown rather than add one", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Allowance");

    await page.getByText("Timer").click();

    await expect.poll(text).toContain("Hours");
    expect(text()).toContain("Minutes");
    expect(text()).toContain("24h");
    expect(text()).toContain("Start timer");
    // The two are alternatives. A form offering both would be setting two rules.
    expect(text()).not.toContain("Resets on day");
  });

  test("given: a second device picked, should: save the limit for all of them, not just this one", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Applies to");
    expect(text()).toContain("This device");

    await page.getByRole("button", { name: "This device" }).click();
    await page.getByText("Kids iPad").click();

    await expect.poll(text).toContain("2 devices");
    expect(text()).toContain("Save limit for all");
    // The choice that is the whole difference a group makes.
    expect(text()).toContain("Shared");
    expect(text()).toContain("Each");
  });

  test("given: a group narrowed to one device, should: keep the group rather than write a rule that starts the count over", async () => {
    heldGroups = [
      {
        groupId: "kids",
        name: "Kids",
        memberKeys: ["42", "43"],
        allocationBytes: 50 * GB,
        autoPause: true,
        cycle: { kind: "monthly", day: 1 },
        mode: "pooled",
        updatedMs: NOW,
        createdMs: NOW,
      },
    ];
    const saved: unknown[] = [];
    render(
      <Harness
        value={meter({
          rule: rule({ groupId: "kids", sharedAllowance: true }),
          save: async (terms) => void saved.push(terms),
        })}
      />,
    );
    await expect.poll(text).toContain("Edit limit");
    await page.getByRole("button", { name: "Edit limit" }).click();

    // A group of more than one opens its picker already expanded, so the rows are
    // there to untick without asking for them.
    await expect.poll(text).toContain("Kids iPad");
    await page.getByText("Kids iPad").click();
    // The button names who it writes for, so losing "for all" is the untick
    // landing — a signal that cannot read as true while the group still has two.
    await expect.poll(text).not.toContain("Save limit for all");
    await page.getByRole("button", { name: "Save limit" }).click();

    // A member's rule carries what this cycle has spent. A device rule of its own
    // opens a fresh cycle, counting from zero.
    await expect.poll(() => groupsSaved).toHaveLength(1);
    expect(groupsSaved[0].memberKeys).toEqual(["42"]);
    expect(groupsRemoved).toEqual([]);
    expect(saved).toEqual([]);
  });

  test("given: a device that is away, should: still offer it, tagging the ones that are here", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Applies to");

    await page.getByRole("button", { name: "This device" }).click();

    // Being offline is a tag on the row, never a reason it cannot be metered.
    await expect.poll(text).toContain("Kids iPad");
    expect(text()).toContain("ACTIVE NOW");
    const away = [...document.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Kids iPad"),
    );
    expect(away?.querySelector("input")?.disabled).toBe(false);
  });

  test("given: a timer over several devices, should: not offer a choice whose options are the same", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Applies to");

    await page.getByText("Timer").click();
    await page.getByRole("button", { name: "This device" }).click();
    await page.getByText("Kids iPad").click();

    await expect.poll(text).toContain("start and end on one clock");
    expect(text()).not.toContain("One allowance between them");
  });

  test("given: the device this card is for, should: refuse to drop it from its own limit", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Applies to");

    await page.getByRole("button", { name: "This device" }).click();
    await page.getByText("PS5 Console").nth(1).click();

    await expect.poll(text).toContain("This device");
    expect(text()).not.toContain("0 devices");
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

  test("given: the Schedule chip, should: offer hours and an allowance beside them, off", async () => {
    render(<Harness value={meter({ rule: null })} />);
    await expect.poll(text).toContain("Allowance");

    await page.getByRole("button", { name: "Schedule" }).click();

    await expect.poll(text).toContain("Every week");
    expect(text()).toContain("Data allowance");
    // Those hours are usually unrestricted, so the cap starts off.
    expect(text()).not.toContain("Resets on day");
  });

  test("given: a device's own rule with a schedule and an allowance, should: keep the schedule when only the allowance is re-saved", async () => {
    // The device card predates the schedule feature and never sent one back, so
    // saving anything from it — even just the allowance — read as a rule with no
    // schedule at all, and the recorder wiped the one already set.
    const schedule = {
      mode: "allow" as const,
      windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 8 * 60, endMinute: 18 * 60 }],
    };
    const saved: unknown[] = [];
    render(
      <Harness
        value={meter({
          rule: rule({ schedule, allocationBytes: 20 * GB }),
          save: async (terms) => void saved.push(terms),
        })}
      />,
    );
    await expect.poll(text).toContain("Edit limit");
    await page.getByRole("button", { name: "Edit limit" }).click();

    await expect.poll(text).toContain("Every week");
    await page.getByRole("button", { name: "Save limit" }).click();

    await expect.poll(() => saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ schedule });
  });

  test("given: a device's own rule with a schedule, should: drop it when switched to Limit by hand", async () => {
    // The opposite of the case above: picking a different chip is the person's own
    // choice to stop keeping the schedule, not a save that never knew about it.
    const schedule = {
      mode: "allow" as const,
      windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 8 * 60, endMinute: 18 * 60 }],
    };
    const saved: unknown[] = [];
    render(
      <Harness
        value={meter({
          rule: rule({ schedule, allocationBytes: 20 * GB }),
          save: async (terms) => void saved.push(terms),
        })}
      />,
    );
    await page.getByRole("button", { name: "Edit limit" }).click();
    await expect.poll(text).toContain("Every week");

    await page.getByRole("button", { name: "Limit", exact: true }).click();
    await page.getByRole("button", { name: "Save limit" }).click();

    await expect.poll(() => saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty("schedule");
  });
});
