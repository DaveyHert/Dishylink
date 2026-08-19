// What is asserted here is what a group adds to a rule: that a shared allowance
// is spent by its members together and takes them all dark on the same reading,
// that a per-member group is the per-device rule run once each, that joining
// keeps what a device has already spent, and that leaving leaves no rule behind.

import { describe, expect, it } from "vitest";
import {
  collapseGroupAnnouncements,
  evaluateMeters,
  usageBytes,
  type MeterReading,
  type MeterRule,
} from "./dataMeter";
import {
  groupForDevice,
  projectGroupRules,
  resolveGroupMembers,
  type DeviceGroup,
} from "./deviceGroup";

const GB = 1_000_000_000;
const T0 = new Date(2026, 7, 12, 15, 30, 0).getTime();
const TABLET = "101";
const CONSOLE = "102";
const LAPTOP = "103";

function group(over: Partial<DeviceGroup> = {}): DeviceGroup {
  return {
    groupId: "kids",
    name: "Kids",
    memberKeys: [TABLET, CONSOLE],
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    mode: "pooled",
    updatedMs: T0,
    ...over,
  };
}

const counters = (entries: Record<string, number>): MeterReading[] =>
  Object.entries(entries).map(([clientKey, lifetimeRx]) => ({
    clientKey,
    lifetimeRx,
    lifetimeTx: 0,
  }));

/** Rules for one group, anchored at zero, then advanced to these counters. */
function rulesAt(theGroup: DeviceGroup, at: Record<string, number>): MeterRule[] {
  const opened = projectGroupRules({
    groups: [theGroup],
    rules: [],
    counters: counters(Object.fromEntries(theGroup.memberKeys.map((key) => [key, 0]))),
    nowMs: T0,
  });
  return evaluateMeters(opened, counters(at), T0 + 1000).rules;
}

describe("projectGroupRules", () => {
  it("given: a group, should: write one rule per member carrying its terms", () => {
    const rules = projectGroupRules({
      groups: [group()],
      rules: [],
      counters: counters({ [TABLET]: 0, [CONSOLE]: 0 }),
      nowMs: T0,
    });
    expect(rules.map((rule) => rule.clientKey)).toEqual([TABLET, CONSOLE]);
    expect(rules.every((rule) => rule.allocationBytes === 50 * GB)).toBe(true);
    expect(rules.every((rule) => rule.groupId === "kids")).toBe(true);
    expect(rules.every((rule) => rule.sharedAllowance === true)).toBe(true);
  });

  it("given: a per-member group, should: leave members charged on their own usage", () => {
    const rules = projectGroupRules({
      groups: [group({ mode: "perMember" })],
      rules: [],
      counters: counters({ [TABLET]: 0, [CONSOLE]: 0 }),
      nowMs: T0,
    });
    expect(rules.every((rule) => rule.sharedAllowance)).toBe(false);
  });

  it("given: a device that already had a rule, should: keep what it has spent", () => {
    const own = projectGroupRules({
      groups: [],
      rules: [
        {
          clientKey: TABLET,
          allocationBytes: 10 * GB,
          autoPause: true,
          cycle: { kind: "monthly", day: 1 },
          anchorRx: 0,
          anchorTx: 0,
          observedRx: 4 * GB,
          observedTx: 0,
          periodStartMs: T0,
          periodEndMs: T0 + 86_400_000,
          actedThisCycle: false,
          pauseState: "none",
        },
      ],
      counters: counters({ [TABLET]: 4 * GB }),
      nowMs: T0,
    });
    const joined = projectGroupRules({
      groups: [group({ memberKeys: [TABLET] })],
      rules: own,
      counters: counters({ [TABLET]: 4 * GB }),
      nowMs: T0,
    });
    expect(usageBytes(joined[0])).toBe(4 * GB);
    expect(joined[0].allocationBytes).toBe(50 * GB);
  });

  it("given: a member that left the group, should: drop its rule rather than restore its own", () => {
    const held = rulesAt(group(), { [TABLET]: 1 * GB, [CONSOLE]: 1 * GB });
    const shrunk = projectGroupRules({
      groups: [group({ memberKeys: [TABLET] })],
      rules: held,
      counters: counters({ [TABLET]: 1 * GB, [CONSOLE]: 1 * GB }),
      nowMs: T0,
    });
    expect(shrunk.map((rule) => rule.clientKey)).toEqual([TABLET]);
  });

  it("given: rules already carrying their group's terms, should: return them untouched", () => {
    const first = projectGroupRules({
      groups: [group()],
      rules: [],
      counters: counters({ [TABLET]: 0, [CONSOLE]: 0 }),
      nowMs: T0,
    });
    const again = projectGroupRules({
      groups: [group()],
      rules: first,
      counters: counters({ [TABLET]: 0, [CONSOLE]: 0 }),
      nowMs: T0 + 200,
    });
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
  });

  it("given: a device listed by two groups, should: meter it under the one set most recently", () => {
    const older = group({ groupId: "old", memberKeys: [TABLET], updatedMs: T0 - 1000 });
    const newer = group({ groupId: "new", memberKeys: [TABLET], updatedMs: T0 });
    const rules = projectGroupRules({
      groups: [older, newer],
      rules: [],
      counters: counters({ [TABLET]: 0 }),
      nowMs: T0,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].groupId).toBe("new");
  });
});

describe("a shared allowance", () => {
  it("given: members under it alone but over it together, should: take them all", () => {
    const rules = rulesAt(group(), { [TABLET]: 30 * GB, [CONSOLE]: 25 * GB });
    expect(rules.every((rule) => rule.actedThisCycle)).toBe(true);
    expect(rules.every((rule) => rule.pauseState === "pending")).toBe(true);
  });

  it("given: the group under its allowance, should: take neither", () => {
    const rules = rulesAt(group(), { [TABLET]: 20 * GB, [CONSOLE]: 20 * GB });
    expect(rules.some((rule) => rule.actedThisCycle)).toBe(false);
  });

  it("given: one member over the allowance alone, should: still take the whole group", () => {
    const rules = rulesAt(group(), { [TABLET]: 55 * GB, [CONSOLE]: 0 });
    expect(rules.every((rule) => rule.pauseState === "pending")).toBe(true);
  });

  it("given: a per-member group, should: take only the member that is over", () => {
    const rules = rulesAt(group({ mode: "perMember" }), { [TABLET]: 55 * GB, [CONSOLE]: 10 * GB });
    expect(rules.find((rule) => rule.clientKey === TABLET)?.pauseState).toBe("pending");
    expect(rules.find((rule) => rule.clientKey === CONSOLE)?.pauseState).toBe("none");
  });

  it("given: a group that crossed, should: announce once rather than once per member", () => {
    const opened = projectGroupRules({
      groups: [group()],
      rules: [],
      counters: counters({ [TABLET]: 0, [CONSOLE]: 0 }),
      nowMs: T0,
    });
    const { transitions } = evaluateMeters(
      opened,
      counters({ [TABLET]: 30 * GB, [CONSOLE]: 25 * GB }),
      T0 + 1000,
    );
    expect(transitions.filter((transition) => transition.kind === "reached")).toHaveLength(2);
  });
});

describe("resolveGroupMembers", () => {
  it("given: a member on a reissued id, should: follow it rather than shrink the group", () => {
    const resolved = resolveGroupMembers([group()], {
      keys: [TABLET, LAPTOP],
      resolveKey: (key) => (key === CONSOLE ? LAPTOP : key),
    });
    expect(resolved[0].memberKeys).toEqual([TABLET, LAPTOP]);
  });

  it("given: two members merged onto one key, should: count the device once", () => {
    const resolved = resolveGroupMembers([group()], {
      keys: [TABLET],
      resolveKey: () => TABLET,
    });
    expect(resolved[0].memberKeys).toEqual([TABLET]);
  });

  it("given: an empty roster, should: drop nobody", () => {
    const resolved = resolveGroupMembers([group()], { keys: [], resolveKey: (key) => key });
    expect(resolved[0].memberKeys).toEqual([TABLET, CONSOLE]);
  });

  it("given: every member gone from the roster, should: drop the group rather than keep a ghost", () => {
    expect(resolveGroupMembers([group()], { keys: [LAPTOP], resolveKey: (key) => key })).toEqual(
      [],
    );
  });

  it("given: one member left, should: keep the group rather than silently unmeter it", () => {
    const resolved = resolveGroupMembers([group()], { keys: [TABLET], resolveKey: (key) => key });
    expect(resolved[0].memberKeys).toEqual([TABLET]);
  });
});

describe("a rule the projection takes away", () => {
  it("given: a member removed from its group, should: be handed back still holding its pause", () => {
    const held = rulesAt(group(), { [TABLET]: 30 * GB, [CONSOLE]: 25 * GB }).map((rule) => ({
      ...rule,
      pauseState: "applied" as const,
    }));
    const kept = projectGroupRules({
      groups: [group({ memberKeys: [TABLET] })],
      rules: held,
      counters: counters({ [TABLET]: 30 * GB, [CONSOLE]: 25 * GB }),
      nowMs: T0,
    });
    const gone = held.filter((rule) => !kept.some((other) => other.clientKey === rule.clientKey));
    // Nothing else knows this device is blocked at the router, so the caller has
    // to be told which rule went and what it was holding.
    expect(gone.map((rule) => rule.clientKey)).toEqual([CONSOLE]);
    expect(gone[0].pauseState).toBe("applied");
  });

  it("given: a device joining a group, should: drop the announcement filed under its own key", () => {
    const own = projectGroupRules({
      groups: [],
      rules: [
        {
          clientKey: TABLET,
          allocationBytes: 10 * GB,
          autoPause: true,
          cycle: { kind: "monthly", day: 1 },
          anchorRx: 0,
          anchorTx: 0,
          observedRx: 20 * GB,
          observedTx: 0,
          periodStartMs: T0,
          periodEndMs: T0 + 86_400_000,
          actedThisCycle: true,
          reachedAtMs: T0,
          pauseState: "applied",
        },
      ],
      counters: counters({ [TABLET]: 20 * GB }),
      nowMs: T0,
    });
    expect(own[0].reachedAtMs).toBe(T0);
    const joined = projectGroupRules({
      groups: [group({ memberKeys: [TABLET, CONSOLE] })],
      rules: own,
      counters: counters({ [TABLET]: 20 * GB, [CONSOLE]: 0 }),
      nowMs: T0,
    });
    // Nothing filed under the group can close an episode opened under the device.
    expect(joined.find((rule) => rule.clientKey === TABLET)?.reachedAtMs).toBeUndefined();
  });
});

describe("a countdown across a group", () => {
  const timer = (over: Partial<DeviceGroup> = {}) =>
    group({ countdownMs: 3_600_000, cycle: { kind: "once" }, mode: "perMember", ...over });

  /** The group running for ten minutes with only the tablet in it. */
  const running = () =>
    projectGroupRules({
      groups: [timer({ memberKeys: [TABLET] })],
      rules: [],
      counters: [],
      nowMs: T0,
    });

  it("given: a member with no rule of its own, should: join the clock the group is on", () => {
    const rules = projectGroupRules({
      groups: [timer()],
      rules: running(),
      counters: [],
      nowMs: T0 + 600_000,
    });
    const starts = new Set(rules.map((rule) => rule.periodStartMs));
    expect(starts).toEqual(new Set([T0]));
  });

  it("given: a member that already carried its own rule, should: join the group's clock too", () => {
    // The half that shipped broken: an existing rule went through upsertRule,
    // which re-times a countdown to now, so the device got a fresh hour while
    // the rest of the group had ten minutes gone.
    const own = projectGroupRules({
      groups: [group({ groupId: "solo", memberKeys: [CONSOLE], countdownMs: undefined })],
      rules: [],
      counters: [],
      nowMs: T0,
    });
    const rules = projectGroupRules({
      groups: [timer()],
      rules: [...running(), ...own.map((rule) => ({ ...rule, groupId: undefined }))],
      counters: [],
      nowMs: T0 + 600_000,
    });
    expect(new Set(rules.map((rule) => rule.periodStartMs))).toEqual(new Set([T0]));
  });

  it("given: a device moved to another group on the same duration, should: start that group's clock", () => {
    const inFirst = projectGroupRules({
      groups: [timer({ groupId: "first", memberKeys: [TABLET] })],
      rules: [],
      counters: [],
      nowMs: T0,
    });
    // Fifty minutes into the first group's hour. Carrying that start into the
    // second would hand the device ten minutes of a fresh hour.
    const moved = projectGroupRules({
      groups: [timer({ groupId: "second", memberKeys: [TABLET], updatedMs: T0 + 3_000_000 })],
      rules: inFirst,
      counters: [],
      nowMs: T0 + 3_000_000,
    });
    expect(moved[0]!.periodStartMs).toBe(T0 + 3_000_000);
  });

  it("given: every member out of time, should: announce once for the group", () => {
    const rules = projectGroupRules({
      groups: [timer({ memberKeys: [TABLET, CONSOLE, LAPTOP] })],
      rules: [],
      counters: [],
      nowMs: T0,
    });
    const { transitions } = evaluateMeters(rules, [], T0 + 3_700_000);
    const reached = transitions.filter((entry) => entry.kind === "reached");
    expect(reached).toHaveLength(3);
    // Each device is still paused; the group is announced once.
    expect(collapseGroupAnnouncements(reached)).toHaveLength(1);
  });
});

describe("groupForDevice", () => {
  it("given: a device in no group, should: report none", () => {
    expect(groupForDevice([group()], LAPTOP)).toBeUndefined();
  });
});
