// Which rule a save writes back to.
//
// A rule reaching this form is either a group's or one a device carries itself,
// and the two are written through different routes. Sending a device's own rule
// to the group route does not fail — it writes a second rule over the same
// device, anchored at today's counter, while the first goes on holding it
// against a limit the form no longer shows. That is what is asserted here.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { DeviceGroup } from "@core/deviceGroup";
import type { Rule } from "../../../hooks/useRules";
import { TooltipProvider } from "../../ui/tooltip";
import { RuleDialog } from "./RuleDialog";

const groupsSaved: { memberKeys: string[]; groupId?: string; name: string }[] = [];
const deviceRulesSaved: string[] = [];
const deviceRulesRemoved: string[] = [];
const groupsRemoved: string[] = [];
const rulesRestarted: { groupId?: string; clientKey?: string }[] = [];
let mockGroupsLoading = false;
let mockPauseEnforceable = true;

vi.mock("../../../hooks/useDeviceGroups", () => ({
  useDeviceGroups: () => ({
    groups: [],
    get pauseEnforceable() {
      return mockPauseEnforceable;
    },
    get loading() {
      return mockGroupsLoading;
    },
    error: null,
    save: async (terms: { memberKeys: string[]; groupId?: string; name: string }) => {
      groupsSaved.push({
        memberKeys: terms.memberKeys,
        groupId: terms.groupId,
        name: terms.name,
      });
    },
    remove: async (groupId: string) => {
      groupsRemoved.push(groupId);
    },
  }),
}));

vi.mock("../../../hooks/useDataMeter", () => ({
  saveDeviceRule: async (clientKey: string) => {
    deviceRulesSaved.push(clientKey);
  },
  removeDeviceRule: async (clientKey: string) => {
    deviceRulesRemoved.push(clientKey);
  },
  restartRule: async (scope: { groupId?: string; clientKey?: string }) => {
    rulesRestarted.push(scope);
  },
}));

vi.mock("../../../hooks/useCloudAccount", () => ({
  useCloudUsage: () => ({ data: undefined }),
}));

const GB = 1_000_000_000;
const NOW = Date.now();

const CANDIDATES = [
  {
    clientKey: "42",
    name: "PS5 Console",
    macAddress: "aa:bb:cc:00:00:01",
    active: true,
    lastSeenMs: NOW,
  },
  {
    clientKey: "43",
    name: "Kids iPad",
    macAddress: "aa:bb:cc:00:00:02",
    active: false,
    lastSeenMs: NOW - 86_400_000,
  },
];

/** A rule the device carries itself: no group behind it, one member, and the
 *  device's own name. */
function deviceRule(over: Partial<Rule> = {}): Rule {
  return {
    id: "42",
    name: "PS5 Console",
    memberKeys: ["42"],
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    mode: "perMember",
    usageBytes: 12 * GB,
    capacityBytes: 50 * GB,
    members: [],
    memberCount: 1,
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

const group: DeviceGroup = {
  groupId: "kids",
  name: "Kids devices",
  memberKeys: ["42", "43"],
  allocationBytes: 20 * GB,
  autoPause: true,
  cycle: { kind: "monthly", day: 1 },
  mode: "perMember",
  updatedMs: NOW,
  createdMs: NOW,
};

function Harness({ rule, open = true }: { rule?: Rule; open?: boolean }) {
  return (
    <TooltipProvider>
      <RuleDialog
        rule={rule}
        candidates={CANDIDATES}
        open={open}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />
    </TooltipProvider>
  );
}

describe("RuleDialog", () => {
  afterEach(() => {
    cleanup();
    groupsSaved.length = 0;
    deviceRulesSaved.length = 0;
    deviceRulesRemoved.length = 0;
    groupsRemoved.length = 0;
    rulesRestarted.length = 0;
    mockGroupsLoading = false;
    mockPauseEnforceable = true;
  });

  test("given: groups still loading, should: say nothing about pausing rather than claim it isn't enforceable yet", async () => {
    // Whether the account can enforce a pause isn't known until the read comes
    // back — defaulting to "not enforceable" would flash a false warning on
    // every account that turns out to be connected just fine.
    mockGroupsLoading = true;
    mockPauseEnforceable = false;
    render(<Harness />);

    await expect.element(page.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(page.getByText("Connect your Starlink account").elements()).toHaveLength(0);
  });

  test("given: a device's own rule, should: save it back to the device", async () => {
    render(<Harness rule={deviceRule()} />);

    await page.getByRole("button", { name: "Save rule" }).click();

    await expect.poll(() => deviceRulesSaved).toEqual(["42"]);
    expect(groupsSaved).toEqual([]);
  });

  test("given: a device's own rule widened to two devices, should: take the first rule with it", async () => {
    // Left standing, the device's own rule holds this device against a limit the
    // group's card never shows.
    render(<Harness rule={deviceRule()} />);

    await page.getByRole("button", { name: "This device" }).click();
    await page.getByText("Kids iPad").click();
    await page.getByRole("button", { name: "Save rule" }).click();

    await expect.poll(() => groupsSaved).toHaveLength(1);
    expect(groupsSaved[0].memberKeys).toEqual(["42", "43"]);
    expect(groupsSaved[0].groupId).toBeUndefined();
    expect(deviceRulesRemoved).toEqual(["42"]);
    expect(deviceRulesSaved).toEqual([]);
  });

  test("given: a group's rule, should: save it back to that group", async () => {
    render(
      <Harness
        rule={deviceRule({ id: "kids", name: "Kids devices", memberKeys: ["42", "43"], group })}
      />,
    );

    await page.getByRole("button", { name: "Save rule" }).click();

    await expect.poll(() => groupsSaved).toHaveLength(1);
    expect(groupsSaved[0].groupId).toBe("kids");
    expect(deviceRulesSaved).toEqual([]);
    expect(deviceRulesRemoved).toEqual([]);
  });

  test("given: a device's own rule, should: offer Start over and Delete rule, and restart by client key", async () => {
    render(<Harness rule={deviceRule()} />);

    await page.getByRole("button", { name: "Start over" }).click();

    await expect.poll(() => rulesRestarted).toEqual([{ clientKey: "42" }]);
  });

  test("given: a device's own rule, should: delete it through the device rather than a group", async () => {
    render(<Harness rule={deviceRule()} />);

    await page.getByRole("button", { name: "Delete rule" }).click();

    await expect.poll(() => deviceRulesRemoved).toEqual(["42"]);
    expect(groupsRemoved).toEqual([]);
  });

  test("given: closing, should: keep showing the rule being edited rather than flash to a blank New rule form", async () => {
    // RulesTab flips `rule` to undefined the instant Cancel or Save fires,
    // in the same update that flips `open` to false — the panel is still
    // mounted and visible through Radix's close animation when that happens,
    // so what it shows must not go blank a beat before it actually closes.
    const screen = await render(<Harness rule={deviceRule()} />);
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("PS5 Console");

    await screen.rerender(<Harness rule={undefined} open={false} />);

    expect(page.getByRole("heading", { name: "Edit rule" }).element()).toBeTruthy();
    expect((page.getByRole("textbox", { name: "Name" }).element() as HTMLInputElement).value).toBe(
      "PS5 Console",
    );
  });

  test("given: a group's rule, should: restart and delete it by group rather than by device", async () => {
    render(
      <Harness
        rule={deviceRule({ id: "kids", name: "Kids devices", memberKeys: ["42", "43"], group })}
      />,
    );

    await page.getByRole("button", { name: "Start over" }).click();
    await expect.poll(() => rulesRestarted).toEqual([{ groupId: "kids" }]);

    await page.getByRole("button", { name: "Delete rule" }).click();
    await expect.poll(() => groupsRemoved).toEqual(["kids"]);
    expect(deviceRulesRemoved).toEqual([]);
  });

  test("given: a new rule, should: open on the limit with no schedule and no allowance switch", async () => {
    render(<Harness />);

    await expect.poll(() => document.body.textContent ?? "").toContain("Allowance");
    const text = document.body.textContent ?? "";
    // A plain limit always carries one, so there is nothing to toggle.
    expect(text).not.toContain("Data allowance");
    expect(text).not.toContain("Every week");
  });

  test("given: schedule picked, should: show the hours and offer an allowance, off", async () => {
    render(<Harness />);
    await page.getByRole("button", { name: "Schedule" }).click();

    const text = () => document.body.textContent ?? "";
    // A window is opened with the mode: a schedule with none reads as a mode that
    // did nothing.
    await expect.poll(text).toContain("Every week");
    expect(text()).toContain("Mon");
    // Those hours are usually unrestricted, so the cap is the exception to opt in.
    expect(text()).toContain("Data allowance");
    const cap = document.querySelector('[role="switch"][aria-checked="true"]');
    expect(text()).toContain("Cap the data these devices use");
    expect(cap).not.toBeNull(); // auto-pause is on; the allowance switch is not
    expect(document.querySelectorAll('[role="switch"][aria-checked="true"]').length).toBe(1);
  });

  test("given: timer picked, should: offer neither a schedule nor an allowance", async () => {
    render(<Harness />);
    await page.getByRole("button", { name: "Timer" }).click();

    const text = () => document.body.textContent ?? "";
    await expect.poll(text).toContain("Hours");
    expect(text()).not.toContain("Every week");
    expect(text()).not.toContain("Data allowance");
    expect(text()).not.toContain("Resets");
  });

  test("given: a rule named after its one device, should: not offer a name to type", async () => {
    render(<Harness rule={deviceRule()} />);

    const name = () =>
      document.querySelector<HTMLInputElement>('input[placeholder="Kids devices"]');
    await expect.poll(() => name()?.value).toBe("PS5 Console");
    expect(name()?.disabled).toBe(true);
  });
});
