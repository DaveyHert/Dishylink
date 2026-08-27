// One device's data allowance, from the historian's rule store.
//
// The rule rides its own request rather than the roster: it changes when someone
// edits it, not on the router's cadence, and the card that shows it is open far
// less often than the network panel behind it.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { announcementSubject, type MeterCycle, type MeterRule } from "@core/dataMeter";
import type { PauseState } from "@core/devicePause";
import { formatScheduleParam, type Schedule } from "@core/schedule";
import { apiRequest } from "../lib/apiHost";
import {
  meterIndicatorForDevice,
  type MeterIndicator,
} from "../components/network/rules/meterIndicator";

const REFRESH_MS = 10_000;

export interface MeterRuleView extends MeterRule {
  /** What the rule is judged against: the group's sum for a member of a shared
   *  allowance, the device's own spend otherwise. */
  usageBytes: number;
  /** What this device itself put through. On a pooled member the rule charges the
   *  group's sum instead, so the two differ. */
  ownUsageBytes: number;
  deviceName: string;
  /** Whether the rule has reached what it measures — the recorder's answer, since
   *  only it holds the group's sum alongside the countdown's clock. */
  reached: boolean;
  /** Whether the device is blocked at the router. Its own state, not this rule's:
   *  several rules can name one device, and the block belongs to the device. */
  pauseState: PauseState;
  /** Whether this rule is one of the reasons the device is held. A card showing
   *  several rules has to say which of them is the one stopping it. */
  holding: boolean;
  pauseError?: string;
  /** The group that set this rule, when a group did. */
  groupName?: string;
}

/** The terms of a rule a device carries of its own, as either surface writes them. */
export interface DeviceRuleTerms {
  allocationBytes: number;
  autoPause: boolean;
  cycle: MeterCycle;
  /** Set to make the rule a countdown rather than an allowance. */
  countdownMs?: number;
  /** The hours the rule lets the device online, alongside its allowance. */
  schedule?: Schedule;
}

export interface DataMeter {
  /** Every rule naming this device: its own, and one for each group it is in. */
  rules: MeterRuleView[];
  /** The one a card leads with — whichever is holding the device, else the first.
   *  A device with no rule has none. */
  rule: MeterRuleView | null;
  /** Whether the recorder can actually pause: the write needs an account session,
   *  and a rule that cannot be enforced should say so before it is relied on. */
  pauseEnforceable: boolean;
  loading: boolean;
  error: string | null;
  save: (terms: DeviceRuleTerms) => Promise<void>;
  restart: () => Promise<void>;
  remove: () => Promise<void>;
  /** Read this rule again now, for a write made outside this hook. */
  reload: () => Promise<void>;
}

export function cycleParams(cycle: MeterCycle): Record<string, string> {
  switch (cycle.kind) {
    case "weekly":
      return { cycle: cycle.kind, weekday: String(cycle.weekday) };
    case "monthly":
    case "billing":
      return { cycle: cycle.kind, day: String(cycle.day) };
    case "custom":
      return { cycle: cycle.kind, days: String(cycle.days), start: String(cycle.startMs) };
    case "daily":
    case "once":
      return { cycle: cycle.kind };
  }
}

/** The rule a card leads with: whichever is holding the device, since that is the
 *  one answering "why is this off?". Its own rule breaks a tie, being the one this
 *  card can edit. */
export function leadingRule(rules: readonly MeterRuleView[]): MeterRuleView | null {
  return (
    rules.find((rule) => rule.holding) ??
    rules.find((rule) => rule.groupId === undefined) ??
    rules[0] ??
    null
  );
}

function deviceRulePath(clientKey: string, terms: DeviceRuleTerms): string {
  const query = new URLSearchParams({
    client: clientKey,
    allocation: String(Math.round(terms.allocationBytes)),
    autoPause: terms.autoPause ? "1" : "0",
    ...cycleParams(terms.cycle),
    ...(terms.countdownMs === undefined
      ? {}
      : { countdown: String(Math.round(terms.countdownMs)) }),
    ...(terms.schedule === undefined ? {} : { schedule: formatScheduleParam(terms.schedule) }),
  });
  return `/api/clients/meters?${query.toString()}`;
}

export function useDataMeter(clientKey: string | null): DataMeter {
  const [rules, setRules] = useState<MeterRuleView[]>([]);
  const [pauseEnforceable, setPauseEnforceable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientKey) return;
    try {
      const response = await apiRequest(
        `/api/clients/meters?client=${encodeURIComponent(clientKey)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        rules?: MeterRuleView[];
        pauseEnforceable?: boolean;
      };
      setRules(body.rules ?? []);
      setPauseEnforceable(body.pauseEnforceable === true);
      setError(null);
    } catch {
      setError("The recorder isn’t answering, so data limits can’t be read or changed.");
    } finally {
      setLoading(false);
    }
  }, [clientKey]);

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

  const write = useCallback(
    async (path: string, method = "POST") => {
      try {
        const response = await apiRequest(path, { method });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setError(null);
      } catch {
        setError("The recorder refused the change.");
      } finally {
        await load();
      }
    },
    [load],
  );

  const save: DataMeter["save"] = useCallback(
    async (terms) => {
      if (!clientKey) return;
      await write(deviceRulePath(clientKey, terms));
    },
    [clientKey, write],
  );

  // The rule the card is showing, not every rule the device answers to: the
  // figures beside this button belong to one of them, and the others are other
  // people's months.
  const leading = leadingRule(rules);
  const leadingGroupId = leading?.groupId;
  const restart = useCallback(async () => {
    if (!clientKey) return;
    const query = new URLSearchParams(
      leadingGroupId === undefined
        ? { client: clientKey }
        : { group: leadingGroupId, client: clientKey },
    );
    await write(`/api/clients/meters/reset?${query.toString()}`);
  }, [clientKey, leadingGroupId, write]);

  const remove = useCallback(async () => {
    if (!clientKey) return;
    await write(`/api/clients/meters?client=${encodeURIComponent(clientKey)}`, "DELETE");
  }, [clientKey, write]);

  return {
    rules,
    rule: leading,
    pauseEnforceable,
    loading,
    error,
    save,
    restart,
    remove,
    reload: load,
  };
}

/** Read the rules again outside this hook's own poll, for a write that changes
 *  them without going through it — a group covers several devices at once. */
export async function refreshMeterIndicators(): Promise<void> {
  await loadMeteredKeys();
}

/**
 * Start one rule over, for a surface holding a rule rather than a device.
 *
 * Named by its group, or by the device carrying its own. Never by device alone: a
 * device answers to as many rules as name it, so that restarts every one of them
 * — a timer on a phone would clear the month's usage of every device that phone
 * shares an allowance with.
 */
export async function restartRule(scope: { groupId?: string; clientKey?: string }): Promise<void> {
  const query = new URLSearchParams(
    scope.groupId === undefined ? { client: scope.clientKey ?? "" } : { group: scope.groupId },
  );
  await apiRequest(`/api/clients/meters/reset?${query.toString()}`, { method: "POST" }).catch(
    () => {},
  );
}

/** Write the rule a device carries of its own, for a surface holding a rule rather
 *  than a device. Throws, so the form that called it can say the write was refused. */
export async function saveDeviceRule(clientKey: string, terms: DeviceRuleTerms): Promise<void> {
  const response = await apiRequest(deviceRulePath(clientKey, terms), { method: "POST" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/** Drop the rule a device carries of its own, leaving the groups that name it
 *  alone — each of those is a rule in its own right, deleted through its group.
 *  Unmetering the device altogether is `DataMeter.remove`, which does both. */
export async function removeDeviceRule(clientKey: string): Promise<void> {
  await apiRequest(`/api/clients/meters?client=${encodeURIComponent(clientKey)}&scope=own`, {
    method: "DELETE",
  }).catch(() => {});
}

let meterIndicators = new Map<string, MeterIndicator>();
let trippedMeters: MeterRuleView[] = [];
let metersEnforceable = false;
const meteredListeners = new Set<() => void>();
let meteredTimerId: number | null = null;

function meterIndicatorSignature(marks: Map<string, MeterIndicator>): string {
  return [...marks].map(([key, mark]) => `${key}:${mark}`).join();
}

function trippedSignature(rules: readonly MeterRuleView[], enforceable: boolean): string {
  return rules
    .map(
      (rule) =>
        `${announcementSubject(rule)}:${rule.allocationBytes}:${rule.countdownMs}:${rule.deviceName}:${rule.groupName}:${enforceable}`,
    )
    .join();
}

async function loadMeteredKeys(): Promise<void> {
  try {
    const response = await apiRequest("/api/clients/meters");
    if (!response.ok) return;
    const body = (await response.json()) as {
      rules?: MeterRuleView[];
      pauseEnforceable?: boolean;
    };
    const rules = body.rules ?? [];
    const nextEnforceable = body.pauseEnforceable === true;
    if (meteredListeners.size === 0) return;
    // Folded per device, not per rule: a device can be named by several rules,
    // and its row shows the strongest mark among them rather than whichever
    // happened to be read last.
    const byDevice = new Map<string, MeterRuleView[]>();
    for (const rule of rules) {
      const held = byDevice.get(rule.clientKey);
      if (held) held.push(rule);
      else byDevice.set(rule.clientKey, [rule]);
    }
    const nextIndicators = new Map(
      [...byDevice].flatMap(([clientKey, forDevice]) => {
        const mark = meterIndicatorForDevice(forDevice);
        return mark === null ? [] : [[clientKey, mark] as const];
      }),
    );
    const indicatorsMoved =
      meterIndicatorSignature(nextIndicators) !== meterIndicatorSignature(meterIndicators);
    // The recorder owns when an announcement retires, so this reads its stamp
    // rather than re-deciding off usage: usage stays over the allowance for the
    // rest of the cycle, and nothing here re-renders on a timer to notice.
    // One entry per announcement, not per rule: a group crosses once, and the
    // recorder filed one episode for it under the group's own key.
    const announcing = new Set<string>();
    const nextTripped = rules.filter((rule) => {
      if (rule.reachedAtMs === undefined) return false;
      const subject = announcementSubject(rule);
      if (announcing.has(subject)) return false;
      announcing.add(subject);
      return true;
    });
    const trippedMoved =
      trippedSignature(nextTripped, nextEnforceable) !==
      trippedSignature(trippedMeters, metersEnforceable);
    if (!indicatorsMoved && !trippedMoved) return;
    if (indicatorsMoved) meterIndicators = nextIndicators;
    if (trippedMoved) {
      trippedMeters = nextTripped;
      metersEnforceable = nextEnforceable;
    }
    for (const listener of meteredListeners) listener();
  } catch {
    // The panel behind these marks reports a silent recorder on its own.
  }
}

function subscribeToMeteredKeys(listener: () => void): () => void {
  meteredListeners.add(listener);
  if (meteredTimerId === null) {
    void loadMeteredKeys();
    meteredTimerId = window.setInterval(() => void loadMeteredKeys(), REFRESH_MS);
  }
  return () => {
    meteredListeners.delete(listener);
    if (meteredListeners.size > 0) return;
    if (meteredTimerId !== null) {
      window.clearInterval(meteredTimerId);
      meteredTimerId = null;
    }
    meterIndicators = new Map();
    trippedMeters = [];
    metersEnforceable = false;
  };
}

/** Whether the recorder behind these rules can actually pause a device. */
export function useMetersEnforceable(): boolean {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => metersEnforceable,
    () => metersEnforceable,
  );
}

export function useMeterIndicators(): Map<string, MeterIndicator> {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => meterIndicators,
    () => meterIndicators,
  );
}

/** Rules that have reached their allowance this cycle. The wording an alert
 *  needs names one device, so no static definition can carry it and the alert
 *  surfaces are built from these instead. */
export function useTrippedMeters(): MeterRuleView[] {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => trippedMeters,
    () => trippedMeters,
  );
}
