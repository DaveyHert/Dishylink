// A group is stored once and projected into one rule per member, so the list
// this folds has every group in it as many times as it has devices. What is
// asserted here is that they come back as one rule apiece, carrying the figure
// the group is actually judged against — which differs between a pooled
// allowance and a per-member one.

import { describe, expect, it } from "vitest";
import type { DeviceGroup } from "@core/deviceGroup";
import { foldRules } from "./useRules";
import type { MeterRuleView } from "./useDataMeter";

const GB = 1_000_000_000;
const NOW = Date.now();

function member(clientKey: string, over: Partial<MeterRuleView> = {}): MeterRuleView {
  const rule: MeterRuleView = {
    clientKey,
    allocationBytes: 20 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    anchorRx: 0,
    anchorTx: 0,
    observedRx: 0,
    observedTx: 0,
    periodStartMs: NOW - 86_400_000,
    periodEndMs: NOW + 86_400_000,
    actedThisCycle: false,
    createdMs: NOW,
    pauseState: "none",
    holding: false,
    usageBytes: 5 * GB,
    ownUsageBytes: over.ownUsageBytes ?? over.usageBytes ?? 5 * GB,
    reached: false,
    deviceName: `device ${clientKey}`,
    ...over,
  };
  // Derived the way the recorder derives it, so a fixture cannot say a rule is
  // out of allowance and holding nothing.
  return {
    ...rule,
    holding:
      over.holding ??
      (rule.actedThisCycle || rule.countdownActed === true || rule.windowBlocked === true),
  };
}

function group(over: Partial<DeviceGroup> = {}): DeviceGroup {
  return {
    groupId: "kids",
    name: "Kids devices",
    memberKeys: ["1", "2"],
    allocationBytes: 20 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    mode: "perMember",
    updatedMs: NOW,
    createdMs: NOW,
    ...over,
  };
}

describe("folding the recorder's rules into a list", () => {
  it("gives a group one entry rather than one per device", () => {
    const rules = foldRules(
      [member("1", { groupId: "kids" }), member("2", { groupId: "kids" })],
      [group()],
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("Kids devices");
    expect(rules[0].memberKeys).toEqual(["1", "2"]);
  });

  it("claims a pause only when this rule is the one holding the device", () => {
    // A device can be off because another rule holds it. A card claiming that
    // pause for its own limit reads as paused beside a figure nowhere near it.
    const rules = foldRules(
      [
        member("1", { groupId: "kids", pauseState: "applied", holding: false }),
        member("2", { groupId: "kids" }),
      ],
      [group()],
    );
    expect(rules[0].paused).toBe(false);
  });

  it("claims the pause when this rule is what is holding the device", () => {
    const rules = foldRules(
      [member("1", { groupId: "kids", pauseState: "applied", holding: true })],
      [group({ memberKeys: ["1"] })],
    );
    expect(rules[0].paused).toBe(true);
  });

  it("reads a per-member group as the data all its devices used", () => {
    // The card's figure is data used, so it is what the devices actually put
    // through. The allowance is tested per device, so the one nearest it rides
    // alongside as the next to be paused.
    const rules = foldRules(
      [
        member("1", { groupId: "kids", usageBytes: 5 * GB }),
        member("2", { groupId: "kids", usageBytes: 3 * GB }),
      ],
      [group()],
    );
    expect(rules[0].usageBytes).toBe(8 * GB);
    expect(rules[0].capacityBytes).toBe(40 * GB);
  });

  it("reads a pooled group off one member, which already carries the sum", () => {
    const rules = foldRules(
      [
        member("1", { groupId: "kids", usageBytes: 8 * GB }),
        member("2", { groupId: "kids", usageBytes: 8 * GB }),
      ],
      [group({ mode: "pooled" })],
    );
    expect(rules[0].usageBytes).toBe(8 * GB);
  });

  it("lets a device that carries its own rule stand for itself", () => {
    const rules = foldRules([member("9", { deviceName: "PS5 Console" })], []);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("PS5 Console");
    expect(rules[0].group).toBeUndefined();
  });

  it("keeps a group whose members have not been projected yet", () => {
    // Written a moment ago: the devices are about to carry it, and dropping it
    // until they do makes a rule someone just created vanish from the list.
    expect(foldRules([], [group()])).toHaveLength(1);
  });

  it("reports a rule as paused when any of its devices is held", () => {
    const rules = foldRules(
      [
        member("1", { groupId: "kids" }),
        member("2", { groupId: "kids", pauseState: "applied", windowBlocked: true }),
      ],
      [group()],
    );
    expect(rules[0].paused).toBe(true);
    expect(rules[0].windowBlocked).toBe(true);
  });
});
