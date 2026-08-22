// Every rule the recorder holds, as one list.
//
// A rule is a group when a group set it and a lone device rule otherwise. Both
// are the same MeterRule underneath — a group is projected into one per member —
// so the list is built by folding the members back into the group that wrote
// them, and letting whatever is left stand for itself.
//
// Read through its own poll rather than the indicator store behind the device
// rows: that one keeps marks and announcements, and widening it to carry whole
// rules would put the panel's marks on this surface's cadence.

import { useCallback, useEffect, useState } from "react";
import { countdownStartMs, type MeterCycle } from "@core/dataMeter";
import type { DeviceGroup, GroupAllowanceMode } from "@core/deviceGroup";
import type { Schedule } from "@core/schedule";
import { apiRequest } from "../lib/apiHost";
import type { MeterRuleView } from "./useDataMeter";

const REFRESH_MS = 10_000;

export interface RuleMember {
  clientKey: string;
  name: string;
  /** This device's own spend. On a pooled member the rule charges the group's sum
   *  instead, so this is what the device itself put through. */
  usageBytes: number;
  /** Whether this rule is holding this device off the network. */
  holding: boolean;
  paused: boolean;
}

export interface Rule {
  /** The group's id, or the device's key for one that carries its own rule. */
  id: string;
  name: string;
  memberKeys: string[];
  /** The group behind this rule, absent on a device's own. */
  group?: DeviceGroup;
  allocationBytes: number;
  autoPause: boolean;
  cycle: MeterCycle;
  mode: GroupAllowanceMode;
  countdownMs?: number;
  schedule?: Schedule;
  /** Data used: the group's own spend for a pooled allowance, and everything its
   *  devices have spent between them otherwise. What the card reads out. */
  usageBytes: number;
  /** What `usageBytes` is measured against: the allowance itself when one is
   *  shared, and one per device when each has its own. The card's figure and its
   *  bar read the same span, rather than a total drawn against one device's cap. */
  capacityBytes: number;
  /** How many of its devices are actually metered. Short of `memberKeys` only
   *  while a rule written a moment ago waits to be projected. */
  memberCount: number;
  /** What each device it covers has spent, for a card listing them. */
  members: RuleMember[];
  /** Any of its devices held by the router because of this rule. */
  paused: boolean;
  /** How many of them, so a rule still running for the rest is not read as
   *  stopped on the strength of one device out of bytes. */
  pausedCount: number;
  reached: boolean;
  /** Shut by its timetable, as against out of allowance. */
  windowBlocked: boolean;
  windowEndMs?: number;
  periodEndMs: number;
  periodStartMs: number;
  countdownStartMs: number;
  createdMs: number;
}

export interface Rules {
  rules: Rule[];
  pauseEnforceable: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function ruleFromGroup(group: DeviceGroup, members: MeterRuleView[]): Rule {
  const first = members[0];
  const pooled = group.mode === "pooled";
  // Data used, both modes: the card's figure is what the rule's devices have
  // actually put through. A pooled member already carries the group's sum;
  // each-mode members spend separately, so theirs add up.
  const spent = pooled
    ? (first?.usageBytes ?? 0)
    : members.reduce((total, member) => total + member.ownUsageBytes, 0);
  return {
    id: group.groupId,
    name: group.name,
    memberKeys: group.memberKeys,
    group,
    allocationBytes: group.allocationBytes,
    autoPause: group.autoPause,
    cycle: group.cycle,
    mode: group.mode,
    countdownMs: group.countdownMs,
    schedule: group.schedule,
    usageBytes: spent,
    // Each device carries the allowance, so the group's capacity is that many
    // times it — which is the span the summed figure above actually fills.
    capacityBytes: pooled
      ? group.allocationBytes
      : group.allocationBytes * Math.max(1, members.length),
    memberCount: members.length,
    members: members.map((member) => ({
      clientKey: member.clientKey,
      name: member.deviceName,
      usageBytes: member.ownUsageBytes,
      holding: member.holding,
      paused: member.pauseState === "applied" && member.holding,
    })),
    // Only the block this rule is itself causing. A device can be off because
    // another rule holds it, and a card claiming that pause for its own limit
    // reads as "paused" beside a figure nowhere near the limit.
    paused: members.some((member) => member.pauseState === "applied" && member.holding),
    pausedCount: members.filter((member) => member.pauseState === "applied" && member.holding)
      .length,
    reached: members.some((member) => member.reached),
    windowBlocked: members.some((member) => member.windowBlocked === true),
    windowEndMs: first?.windowEndMs,
    periodEndMs: first?.periodEndMs ?? Number.POSITIVE_INFINITY,
    periodStartMs: first?.periodStartMs ?? 0,
    countdownStartMs: first ? countdownStartMs(first) : 0,
    createdMs: group.createdMs,
  };
}

function ruleFromDevice(rule: MeterRuleView): Rule {
  return {
    id: rule.clientKey,
    name: rule.deviceName,
    memberKeys: [rule.clientKey],
    allocationBytes: rule.allocationBytes,
    autoPause: rule.autoPause,
    cycle: rule.cycle,
    mode: "perMember",
    countdownMs: rule.countdownMs,
    schedule: rule.schedule,
    usageBytes: rule.usageBytes,
    capacityBytes: rule.allocationBytes,
    memberCount: 1,
    members: [
      {
        clientKey: rule.clientKey,
        name: rule.deviceName,
        usageBytes: rule.ownUsageBytes,
        holding: rule.holding,
        paused: rule.pauseState === "applied" && rule.holding,
      },
    ],
    paused: rule.pauseState === "applied" && rule.holding,
    pausedCount: rule.pauseState === "applied" && rule.holding ? 1 : 0,
    reached: rule.reached,
    windowBlocked: rule.windowBlocked === true,
    windowEndMs: rule.windowEndMs,
    periodEndMs: rule.periodEndMs,
    periodStartMs: rule.periodStartMs,
    countdownStartMs: countdownStartMs(rule),
    createdMs: rule.createdMs,
  };
}

export function foldRules(rules: MeterRuleView[], groups: DeviceGroup[]): Rule[] {
  const membersByGroup = new Map<string, MeterRuleView[]>();
  for (const rule of rules) {
    if (rule.groupId === undefined) continue;
    const held = membersByGroup.get(rule.groupId);
    if (held) held.push(rule);
    else membersByGroup.set(rule.groupId, [rule]);
  }
  // Groups first, and a group whose members have not been projected yet still
  // stands: it was written a moment ago and its devices are about to carry it.
  return [
    ...groups.map((group) => ruleFromGroup(group, membersByGroup.get(group.groupId) ?? [])),
    ...rules.filter((rule) => rule.groupId === undefined).map(ruleFromDevice),
  ];
}

export function useRules(): Rules {
  const [rules, setRules] = useState<Rule[]>([]);
  const [pauseEnforceable, setPauseEnforceable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meterReply, groupReply] = await Promise.all([
        apiRequest("/api/clients/meters"),
        apiRequest("/api/clients/groups"),
      ]);
      if (!meterReply.ok || !groupReply.ok) throw new Error("HTTP");
      const meterBody = (await meterReply.json()) as {
        rules?: MeterRuleView[];
        pauseEnforceable?: boolean;
      };
      const groupBody = (await groupReply.json()) as { groups?: DeviceGroup[] };
      setRules(foldRules(meterBody.rules ?? [], groupBody.groups ?? []));
      setPauseEnforceable(meterBody.pauseEnforceable === true);
      setError(null);
    } catch {
      setError("The recorder isn’t answering, so rules can’t be read or changed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await load();
    };
    void tick();
    const timerId = window.setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [load]);

  return { rules, pauseEnforceable, loading, error, reload: load };
}
