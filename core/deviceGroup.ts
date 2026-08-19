// A data allowance set across several devices at once.
//
// A group owns no metering arithmetic of its own: it is projected into ordinary
// per-device MeterRules, one per member, so pause writes, retries, cycle rolls
// and key resolution run exactly as they do for a rule set on a single device.
// The only thing evaluation adds for a group is that a pooled member is charged
// the group's summed usage rather than its own.
//
// Joining a group replaces whatever rule the device carried, so a device holds
// exactly one rule at any moment.

import {
  chargedBytes,
  sharedUsageByGroup,
  upsertRule,
  type MeterCycle,
  type MeterReading,
  type MeterRoster,
  type MeterRule,
} from "./dataMeter";

/** `pooled` charges members the sum of what they have all spent, so they cross
 *  together. `perMember` gives each the full allowance to spend on its own. */
export type GroupAllowanceMode = "pooled" | "perMember";

export interface DeviceGroup {
  groupId: string;
  name: string;
  /** The group is the authority on its own membership, rather than it being
   *  inferred from whichever projected rules happen to have survived. */
  memberKeys: string[];
  allocationBytes: number;
  autoPause: boolean;
  cycle: MeterCycle;
  mode: GroupAllowanceMode;
  /** Set to make this a countdown across the group rather than an allowance. The
   *  whole group is paused when the time is up, so pooled and per-member describe
   *  the same behaviour and the mode stops mattering. */
  countdownMs?: number;
  /** A device listed by two groups answers to the one set most recently. */
  updatedMs: number;
}

/** The group a device is metered by, or undefined when it carries its own rule. */
export function groupForDevice(
  groups: readonly DeviceGroup[],
  clientKey: string,
): DeviceGroup | undefined {
  let held: DeviceGroup | undefined;
  for (const group of groups) {
    if (!group.memberKeys.includes(clientKey)) continue;
    if (!held || group.updatedMs > held.updatedMs) held = group;
  }
  return held;
}

/**
 * Move members onto the identities their devices now answer to, dropping any the
 * recorder no longer holds.
 *
 * A member left behind on a reissued id shrinks the group, which makes a pooled
 * allowance cross later than it was set to. An empty roster is a recorder that
 * has folded no reading yet, so nothing is dropped against one.
 *
 * A group whose last member is gone is dropped: it can never be reached, and it
 * would meter again unannounced if one of those devices came back. A group down
 * to one member is kept, since deleting it would take a limit the user set with
 * nothing said about it.
 */
export function resolveGroupMembers(
  groups: readonly DeviceGroup[],
  roster: MeterRoster,
): DeviceGroup[] {
  if (roster.keys.length === 0) return [...groups];
  const known = new Set(roster.keys);
  return groups.flatMap((group) => {
    const resolved: string[] = [];
    for (const memberKey of group.memberKeys) {
      const current = roster.resolveKey(memberKey);
      // A merge can land two members on one key; counting it twice would spend
      // the allowance at double rate.
      if (known.has(current) && !resolved.includes(current)) resolved.push(current);
    }
    if (resolved.length === 0) return [];
    return resolved.length === group.memberKeys.length &&
      resolved.every((key, index) => key === group.memberKeys[index])
      ? [group]
      : [{ ...group, memberKeys: resolved }];
  });
}

/**
 * The rule set the groups and the standing device rules together describe.
 *
 * Members keep whatever anchors their device's own rule held, so moving into a
 * group, or between groups, never re-opens a cycle or forgets a spend. A rule
 * left over from a group the device has left is dropped rather than reverting to
 * the limit the device carried before it joined.
 *
 * A member whose rule already carries its group's terms is returned untouched, so
 * this can run on the poll rather than only when a group is edited.
 */
function carriesTermsOf(rule: MeterRule, group: DeviceGroup): boolean {
  return (
    rule.groupId === group.groupId &&
    (rule.sharedAllowance ?? false) === (group.mode === "pooled") &&
    rule.allocationBytes === group.allocationBytes &&
    rule.autoPause === group.autoPause &&
    rule.countdownMs === group.countdownMs &&
    JSON.stringify(rule.cycle) === JSON.stringify(group.cycle)
  );
}

export function projectGroupRules(options: {
  groups: readonly DeviceGroup[];
  rules: readonly MeterRule[];
  counters: readonly MeterReading[];
  nowMs: number;
}): MeterRule[] {
  const { groups, rules, counters, nowMs } = options;
  const ruleByKey = new Map(rules.map((rule) => [rule.clientKey, rule]));
  const counterByKey = new Map(counters.map((reading) => [reading.clientKey, reading]));
  const sharedUsage = sharedUsageByGroup(rules);

  const startedByGroup = new Map<string, number>();
  for (const rule of rules) {
    if (rule.groupId === undefined || rule.countdownMs === undefined) continue;
    const started = startedByGroup.get(rule.groupId);
    if (started === undefined || rule.periodStartMs < started)
      startedByGroup.set(rule.groupId, rule.periodStartMs);
  }

  const projected: MeterRule[] = [];
  const claimed = new Set<string>();

  for (const group of groups) {
    for (const clientKey of group.memberKeys) {
      if (groupForDevice(groups, clientKey)?.groupId !== group.groupId) continue;
      if (claimed.has(clientKey)) continue;
      claimed.add(clientKey);
      const existing = ruleByKey.get(clientKey);
      if (existing && carriesTermsOf(existing, group)) {
        projected.push(existing);
        continue;
      }
      const counter = counterByKey.get(clientKey);
      // A countdown across a group is one clock, so every member reads the start
      // the group is already on rather than each timing its own. A group with no
      // timer rule yet is starting now, and the members after this one join it.
      const groupClock =
        group.countdownMs === undefined ? undefined : (startedByGroup.get(group.groupId) ?? nowMs);
      const written = upsertRule(existing, {
        clientKey,
        allocationBytes: group.allocationBytes,
        autoPause: group.autoPause,
        cycle: group.cycle,
        lifetimeRx: counter?.lifetimeRx ?? existing?.observedRx ?? 0,
        lifetimeTx: counter?.lifetimeTx ?? existing?.observedTx ?? 0,
        nowMs,
        groupId: group.groupId,
        sharedAllowance: group.mode === "pooled",
        countdownMs: group.countdownMs,
        chargedBytes: existing ? chargedBytes(existing, sharedUsage) : 0,
      });
      projected.push(
        groupClock === undefined ? written : { ...written, periodStartMs: groupClock },
      );
    }
  }

  for (const rule of rules) {
    if (claimed.has(rule.clientKey) || rule.groupId !== undefined) continue;
    projected.push(rule);
  }

  return projected;
}
