// A data allowance set across several devices at once.
//
// A group owns no metering arithmetic of its own: it is projected into ordinary
// per-device MeterRules, one per member, so pause writes, retries, cycle rolls
// and key resolution run exactly as they do for a rule set on a single device.
// The only thing evaluation adds for a group is that a pooled member is charged
// the group's summed usage rather than its own.
//
// A device answers to every group that names it, and to its own rule beside them.
// Nothing here resolves between them: each rule holds the device or it does not,
// and the device is free when none of them do.

import {
  chargedBytes,
  countdownStartMs,
  ruleKey,
  sharedUsageByGroup,
  upsertRule,
  type MeterCycle,
  type MeterReading,
  type MeterRoster,
  type MeterRule,
} from "./dataMeter";
import type { Schedule } from "./schedule";

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
  /**
   * The hours the group lets its members online.
   *
   * Held on the group rather than per member, because the arrangement someone
   * writes down — "the kids are online from four until eight" — is one timetable
   * over a set of devices, not a copy of it on each. Sits beside the allowance,
   * so one rule can keep both and the stricter of the two decides.
   */
  schedule?: Schedule;
  /** A device listed by two groups answers to the one set most recently. */
  updatedMs: number;
  createdMs: number;
}

/**
 * An id for a group being created, unique against the groups already held.
 *
 * The clock alone is not enough: two groups written in the same millisecond — two
 * windows, or the desktop and the extension against one store — land on one id,
 * and `upsert` replaces by id, so the second silently takes the first's place. The
 * random half makes that a coincidence rather than a certainty, and the check
 * against `taken` makes it impossible.
 *
 * Prefixed `group-` because `ruleKey` puts this in the same string as a device's
 * key, and the two must never read as one rule.
 */
export function newGroupId(taken: readonly DeviceGroup[], nowMs: number): string {
  const held = new Set(taken.map((group) => group.groupId));
  for (;;) {
    const suffix = Math.floor(Math.random() * 36 ** 4)
      .toString(36)
      .padStart(4, "0");
    const groupId = `group-${nowMs.toString(36)}${suffix}`;
    if (!held.has(groupId)) return groupId;
  }
}

/** Every group metering a device, newest first — the order a card lists them in,
 *  and empty for a device carrying only its own rule. */
export function groupsForDevice(groups: readonly DeviceGroup[], clientKey: string): DeviceGroup[] {
  return groups
    .filter((group) => group.memberKeys.includes(clientKey))
    .sort((first, second) => second.updatedMs - first.updatedMs);
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

/** Whether a member's rule already says what its group says. A rule that does is
 *  returned untouched, so this can run on the poll rather than only on an edit. */
function carriesTermsOf(rule: MeterRule, group: DeviceGroup): boolean {
  return (
    rule.groupId === group.groupId &&
    (rule.sharedAllowance ?? false) === (group.mode === "pooled") &&
    rule.allocationBytes === group.allocationBytes &&
    rule.autoPause === group.autoPause &&
    rule.countdownMs === group.countdownMs &&
    JSON.stringify(rule.cycle) === JSON.stringify(group.cycle) &&
    // A member holding hours its group no longer keeps is out of date and owed a
    // rewrite. Miss it and an edited timetable never reaches the devices.
    JSON.stringify(rule.schedule ?? null) === JSON.stringify(group.schedule ?? null)
  );
}

/**
 * When a group's countdown is running from.
 *
 * One clock for the whole group, so its members end together and a device added
 * half way through joins the sitting rather than starting a fresh one.
 *
 * The clock belongs to the countdown alone, not to the group's other terms: a
 * member already running this duration names the clock, whatever else has since
 * been edited. Read off every term, raising the allowance would restart the timer
 * beside it and hand back a sitting that had already run out — silently, since
 * nothing about that edit mentions the clock. A duration that actually changed
 * finds no such member and starts from now, which is what makes an edited timer
 * begin again.
 */
function groupClock(
  group: DeviceGroup,
  rules: readonly MeterRule[],
  nowMs: number,
): number | undefined {
  if (group.countdownMs === undefined) return undefined;
  const running = rules.find(
    (rule) => rule.groupId === group.groupId && rule.countdownMs === group.countdownMs,
  );
  return running ? countdownStartMs(running) : nowMs;
}

/**
 * The rule set the groups and the standing device rules together describe.
 *
 * One rule per group per member, plus whatever rule each device carries of its
 * own. A device named by three groups holds three rules, and each of them decides
 * on its own terms whether it is holding the device.
 *
 * Members keep whatever anchors their rule already held, so an edit never re-opens
 * a cycle or forgets a spend. A rule left over from a group the device has left is
 * dropped — and dropping it is safe, because nothing about the router's view of
 * that device lives on the rule.
 */
export function projectGroupRules(options: {
  groups: readonly DeviceGroup[];
  rules: readonly MeterRule[];
  counters: readonly MeterReading[];
  nowMs: number;
}): MeterRule[] {
  const { groups, rules, counters, nowMs } = options;
  const ruleByKey = new Map(rules.map((rule) => [ruleKey(rule), rule]));
  const counterByKey = new Map(counters.map((reading) => [reading.clientKey, reading]));
  const sharedUsage = sharedUsageByGroup(rules);

  const projected: MeterRule[] = [];
  const claimed = new Set<string>();

  for (const group of groups) {
    const clock = groupClock(group, rules, nowMs);
    for (const clientKey of group.memberKeys) {
      const key = ruleKey({ clientKey, groupId: group.groupId });
      if (claimed.has(key)) continue;
      claimed.add(key);
      const existing = ruleByKey.get(key);
      if (existing && carriesTermsOf(existing, group)) {
        projected.push(existing);
        continue;
      }
      const counter = counterByKey.get(clientKey);
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
        schedule: group.schedule,
        chargedBytes: existing ? chargedBytes(existing, sharedUsage) : 0,
      });
      // A timer still running on its old clock keeps its latch too. `upsertRule`
      // clears it for a countdown someone has just set, and an edit to the terms
      // beside it would otherwise let a spent sitting go on.
      projected.push(
        clock === undefined
          ? written
          : {
              ...written,
              countdownStartMs: clock,
              ...(existing !== undefined && clock === countdownStartMs(existing)
                ? { countdownActed: existing.countdownActed }
                : {}),
            },
      );
    }
  }

  // A device's own rule stands beside its groups' rather than being replaced by
  // them: it is a separate thing someone set, and it says so on its own card.
  for (const rule of rules) if (rule.groupId === undefined) projected.push(rule);

  return projected;
}
