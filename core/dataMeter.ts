// Per-device data allowances: when a device has spent its share of a cycle, and
// what to do about it. The decision only — no clock, no storage, no router.
//
// A rule measures the same counter the odometer keeps, from an anchor of its own:
// usage this cycle is `lifetime - anchor`, so a device's allowance and the month
// the usage list shows are two spans of one counter rather than two figures kept
// in step. Clearing a cycle moves the anchor up to the counter, exactly as a
// month roll does.
//
// Split from the recorders for the reason ClientTotalsCore is: two hosts fold
// these readings on different schedules — the desktop on its 200 ms client poll,
// the extension on a 30 s alarm that tears its worker down in between — and two
// recorders reaching different verdicts about one device is the failure this
// prevents. Nothing here holds state between calls; a rule carries everything
// that has to survive, because on one of those hosts nothing else can.

import { scheduleActive, scheduleSegment, type Schedule } from "./schedule";

/**
 * Whether a reconciled list differs from the one it was built from.
 *
 * Length first: every one of these lists can shrink — a rule whose device left
 * the roster, a group whose last member did — and comparing only by index reads
 * a list that lost its tail as unchanged, so the drop is never persisted.
 */
export function listChanged<T>(next: readonly T[], previous: readonly T[]): boolean {
  return next.length !== previous.length || next.some((item, index) => item !== previous[index]);
}

/** What one device's counter reads now. The caller resolves identity first: a
 *  rule set on an identity the router has since reissued is keyed to the bucket
 *  that identity was merged into, and only the odometer can say which that is. */
export interface MeterReading {
  clientKey: string;
  lifetimeRx: number;
  lifetimeTx: number;
}

/** When a rule's allowance starts over. */
export type MeterCycle =
  | { kind: "daily" }
  /** `weekday` is 0-6 from Sunday, as Date.getDay reports it. */
  | { kind: "weekly"; weekday: number }
  /** `day` is the day of the month it rolls on, clamped to short months. */
  | { kind: "monthly"; day: number }
  | { kind: "custom"; days: number; startMs: number }
  /** The account's own cycle, not the calendar month. `day` is copied from the
   *  signed-in account when the rule is set. */
  | { kind: "billing"; day: number }
  /** A fixed allowance that never rolls: sold once, topped up by hand. */
  | { kind: "once" };

export interface MeterRule {
  clientKey: string;
  /** The cycle's budget, and the point the device is paused at. */
  allocationBytes: number;
  /** False watches without enforcing: usage is still counted, the cycle still
   *  rolls, and reaching the allowance is still announced — only the pause is
   *  never sent. */
  autoPause: boolean;
  cycle: MeterCycle;
  /** Counter values when this cycle opened. */
  anchorRx: number;
  anchorTx: number;
  /** Counter values as last seen. Kept so a cycle can roll for a device that is
   *  offline: its counter is frozen while it is away, so the last reading is
   *  still the right anchor for the cycle starting now. */
  observedRx: number;
  observedTx: number;
  periodStartMs: number;
  /** Infinity for a cycle that never rolls. */
  periodEndMs: number;
  /** Whether this cycle's allowance has already been acted on. "Acted", not
   *  "over": a device the user unpauses by hand stays unpaused, rather than being
   *  paused again on the next reading. */
  actedThisCycle: boolean;
  /** When this cycle's allowance was reached, for as long as the announcement
   *  stands. Absent once it has retired — and absent on a rule stored before the
   *  stamp existed, which reads as one whose announcement is already over. */
  reachedAtMs?: number;
  /** When its terms were last set. Absent on a rule written before the stamp
   *  existed, which loses to any rule carrying one. */
  updatedMs?: number;
  createdMs: number;
  /** The group this rule was projected from, absent when the device carries its
   *  own. A device can be named by several groups, and holds one rule for each. */
  groupId?: string;
  /** Charges this member the group's summed usage rather than its own, so the
   *  members of one allowance cross together. */
  sharedAllowance?: boolean;
  /** A countdown beside the allowance: the device is held once this much time has
   *  passed, whatever it has spent. Capped at a day. */
  countdownMs?: number;
  /**
   * When the countdown started, and whether it has already been acted on.
   *
   * Its own clock rather than periodStartMs, for the reason the timetable keeps
   * its own boundary: a rule carrying both a monthly allowance and a two-hour
   * timer would otherwise have to be written on a cycle that never rolls, and the
   * allowance beside it would never roll either.
   */
  countdownStartMs?: number;
  countdownActed?: boolean;
  /** The hours this rule lets the device online. Beside the other two rather than
   *  instead of them, so one rule can hold "4pm to 8pm on weekdays", "20 GB a
   *  month" and "two hours a sitting" at once; the strictest decides. */
  schedule?: Schedule;
  /**
   * When the timetable's current stretch turns over, and whether that stretch
   * holds the device shut.
   *
   * Its own boundary rather than periodEndMs: a rule carrying both a monthly
   * allowance and a nightly window would otherwise re-anchor the counters every
   * time the window closed, zeroing the month's usage once a night.
   */
  windowEndMs?: number;
  windowBlocked?: boolean;
  /** The window's form of actedThisCycle, so a device someone unpauses by hand
   *  stays unpaused until the timetable next turns over. */
  windowActed?: boolean;
}

export interface MeterTransition {
  /** `reached` — a rule has run out of one of the things it measures. `expired` —
   *  that announcement has stood its minute and retires.
   *
   *  Announcements only. What the router is told is derived from the rules
   *  themselves on every poll — `pausesOwed` and `releasesOwed` — rather than from
   *  an edge some path has to remember to raise and another to deliver. */
  kind: "reached" | "expired";
  clientKey: string;
  /** Bytes used in the cycle that just ended, or the one still running. */
  usageBytes: number;
  atMs: number;
  rule: MeterRule;
}

const DAY_MS = 86_400_000;

/** How long a spent-allowance announcement stands. Reaching an allowance is an
 *  event, not a condition to sit in: the cap lasts the rest of the cycle, which
 *  on a rule that never rolls is forever, and the history keeps the record. */
export const METER_ALERT_HOLD_MS = 60_000;

/** Local midnight on the day `atMs` falls in. */
function startOfDay(atMs: number): number {
  const date = new Date(atMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local midnight on `day` of `atMs`'s month, with a day past the month's length
 *  landing on its last day — so a rule rolling on the 31st still rolls in June. */
function dayOfMonth(atMs: number, day: number, monthOffset = 0): number {
  const date = new Date(atMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  date.setMonth(date.getMonth() + monthOffset);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date.getTime();
}

/** The allowance as an announcement names it. Every host shares one alert key, so
 *  the figure has to read the same from all of them. */
export function formatAllowance(bytes: number): string {
  return bytes >= 1e12 ? `${(bytes / 1e12).toFixed(2)} TB` : `${(bytes / 1e9).toFixed(1)} GB`;
}

export function splitDuration(totalMs: number): { hours: number; minutes: number } {
  const whole = Math.max(0, Math.round(totalMs / 60_000));
  return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}

/** "1h 20m" / "45m" — a countdown at a glance. Beside formatAllowance because a
 *  timer and an allowance are the two things a rule can measure, and an
 *  announcement and the card that raised it have to word either the same way. */
export function formatDuration(totalMs: number): string {
  const { hours, minutes } = splitDuration(totalMs);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** The cycle a write asks for, or null when it names none. Values are clamped. */
export function cycleFromParams(params: URLSearchParams, nowMs: number): MeterCycle | null {
  const number = (name: string, fallback: number) => {
    const raw = params.get(name);
    const value = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const dayOfTheMonth = () => Math.min(31, Math.max(1, number("day", 1)));
  switch (params.get("cycle")) {
    case "daily":
      return { kind: "daily" };
    case "once":
      return { kind: "once" };
    case "weekly":
      return { kind: "weekly", weekday: Math.min(6, Math.max(0, number("weekday", 1))) };
    case "monthly":
      return { kind: "monthly", day: dayOfTheMonth() };
    case "billing":
      return { kind: "billing", day: dayOfTheMonth() };
    case "custom":
      return {
        kind: "custom",
        days: Math.max(1, number("days", 30)),
        startMs: number("start", nowMs),
      };
    default:
      return null;
  }
}

/** The cycle `atMs` falls in. */
export function periodBounds(cycle: MeterCycle, atMs: number): { startMs: number; endMs: number } {
  switch (cycle.kind) {
    case "daily": {
      const startMs = startOfDay(atMs);
      return { startMs, endMs: startMs + DAY_MS };
    }
    case "weekly": {
      const today = startOfDay(atMs);
      const back = (new Date(today).getDay() - cycle.weekday + 7) % 7;
      const startMs = today - back * DAY_MS;
      return { startMs, endMs: startMs + 7 * DAY_MS };
    }
    case "monthly": {
      const thisMonth = dayOfMonth(atMs, cycle.day);
      const startMs = atMs >= thisMonth ? thisMonth : dayOfMonth(atMs, cycle.day, -1);
      const endMs = atMs >= thisMonth ? dayOfMonth(atMs, cycle.day, 1) : thisMonth;
      return { startMs, endMs };
    }
    case "custom": {
      const span = Math.max(1, Math.round(cycle.days)) * DAY_MS;
      // Counted from the rule's own start date, so a cycle that began before the
      // rule was written still lands on the same boundaries.
      const elapsed = atMs - cycle.startMs;
      const periods = Math.floor(elapsed / span);
      const startMs = cycle.startMs + periods * span;
      return { startMs, endMs: startMs + span };
    }
    case "billing":
      return periodBounds({ kind: "monthly", day: cycle.day }, atMs);
    case "once":
      return { startMs: 0, endMs: Number.POSITIVE_INFINITY };
  }
}

/** Where a cycle that has just opened starts. A cycle that never rolls sits on no
 *  calendar boundary — `periodBounds` reports the epoch for it, which would read
 *  as a cycle running since 1970 — so it starts at the moment it was opened. */
function cycleStartMs(cycle: MeterCycle, bounds: { startMs: number }, nowMs: number): number {
  return cycle.kind === "once" ? nowMs : bounds.startMs;
}

/**
 * A rule as it reads coming back from storage.
 *
 * JSON cannot write the Infinity a cycle that never rolls ends on: it lands as
 * null, which every comparison reads as a boundary already past, so the cycle
 * rolls on the first poll after a restart and re-anchors the counters under it.
 *
 * A countdown written before it had a clock of its own kept its start in
 * `periodStartMs`, on a cycle forced to one that never rolls. Reading that start
 * across, and its latch off the cycle's, leaves the timer where the user set it
 * rather than restarting it under them.
 */
export function restoredRule(rule: MeterRule): MeterRule {
  const restored =
    rule.countdownMs === undefined || rule.countdownStartMs !== undefined
      ? rule
      : { ...rule, countdownStartMs: rule.periodStartMs, countdownActed: rule.actedThisCycle };
  return Number.isFinite(restored.periodEndMs)
    ? restored
    : { ...restored, periodEndMs: Number.POSITIVE_INFINITY };
}

/** Bytes a rule has counted this cycle. Floored, so an anchor left above the
 *  counter reads as a fresh cycle rather than as negative traffic. */
export function usageBytes(rule: MeterRule): number {
  return (
    Math.max(0, rule.observedRx - rule.anchorRx) + Math.max(0, rule.observedTx - rule.anchorTx)
  );
}

/**
 * Whether this rule's announcement belongs to its group rather than its device.
 *
 * A shared allowance crosses once, for the group. A countdown ends on one clock
 * for every member, so it too is one thing happening rather than one per device —
 * which is why the card does not offer shared-or-each while a timer is set.
 */
export function announcesAsGroup(rule: MeterRule): boolean {
  return (
    rule.groupId !== undefined && (rule.sharedAllowance === true || rule.countdownMs !== undefined)
  );
}

/** What an announcement about this rule is keyed to: the group when the group is
 *  what crossed, the device otherwise. A rule whose subject changes owes the old
 *  one a clearing, since nothing under the new key can close an episode opened
 *  under the old. */
export function announcementSubject(rule: MeterRule): string {
  return announcesAsGroup(rule) ? `group:${rule.groupId}` : rule.clientKey;
}

/** What each shared allowance has spent, summed across its members. Derived on
 *  every read rather than stored, so no member can hold a stale copy of it. */
export function sharedUsageByGroup(rules: readonly MeterRule[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const rule of rules) {
    if (rule.groupId === undefined || !rule.sharedAllowance) continue;
    totals.set(rule.groupId, (totals.get(rule.groupId) ?? 0) + usageBytes(rule));
  }
  return totals;
}

/**
 * Bytes charged against a rule's allowance: its own usage, or the group's summed
 * usage for a member sharing one allowance.
 *
 * Every comparison against `allocationBytes` goes through here. One left reading
 * `usageBytes` directly lets a member re-arm while its group is still over.
 *
 * `sharedUsage` is required rather than defaulted: an omitted map reads as the
 * member's own usage, which is a plausible wrong answer the compiler would let
 * through. `sharedUsageByGroup` builds it from whatever rule set the caller holds.
 */
export function chargedBytes(rule: MeterRule, sharedUsage: ReadonlyMap<string, number>): number {
  const own = usageBytes(rule);
  if (rule.groupId === undefined || !rule.sharedAllowance) return own;
  return sharedUsage.get(rule.groupId) ?? own;
}

/** The longest countdown a timer rule can be set to. */
export const MAX_COUNTDOWN_MS = 24 * 3_600_000;

/** When a rule's countdown began. Falls back to the cycle's own start, which is
 *  where it was kept before the countdown had a clock of its own. */
export function countdownStartMs(rule: MeterRule): number {
  return rule.countdownStartMs ?? rule.periodStartMs;
}

/** How long a countdown has left, or null on a rule that keeps none. */
export function countdownLeftMs(rule: MeterRule, nowMs: number): number | null {
  if (rule.countdownMs === undefined) return null;
  return Math.max(0, countdownStartMs(rule) + rule.countdownMs - nowMs);
}

/**
 * Whether the bytes charged to this rule have reached its allowance.
 *
 * No allowance is not an allowance of nothing: a rule measuring only the clock
 * would otherwise read as spent on the first poll, before the device had sent a
 * byte.
 */
export function allocationSpent(
  rule: MeterRule,
  sharedUsage: ReadonlyMap<string, number>,
): boolean {
  if (rule.allocationBytes <= 0) return false;
  return chargedBytes(rule, sharedUsage) >= rule.allocationBytes;
}

/** Whether this rule's countdown has run out. */
export function countdownSpent(rule: MeterRule, nowMs: number): boolean {
  return rule.countdownMs !== undefined && (countdownLeftMs(rule, nowMs) ?? 0) <= 0;
}

/** Read off the rule rather than recomputed, so every caller agrees on one answer
 *  between turnovers instead of each asking the clock at its own moment. */
export function windowShut(rule: MeterRule): boolean {
  return rule.windowBlocked === true;
}

/**
 * Whether a rule has reached any of the three things it can measure.
 *
 * The measures stack rather than replace each other: a rule can cap the month,
 * cap the sitting and name the hours all at once, and whichever runs out first
 * holds the device.
 */
export function ruleSpent(
  rule: MeterRule,
  nowMs: number,
  sharedUsage: ReadonlyMap<string, number>,
): boolean {
  return allocationSpent(rule, sharedUsage) || countdownSpent(rule, nowMs) || windowShut(rule);
}

/**
 * Whether this rule is holding its device off the network.
 *
 * Off the latches, not off the measures: a cycle that has rolled clears its own
 * latch, but the countdown beside it may still be up, and a device someone
 * unpaused by hand must not be paused again by the same latch that paused it
 * once. The strictest of the three wins, and the device is free only when all
 * three have let go.
 */
export function ruleHoldsDevice(rule: MeterRule): boolean {
  return rule.actedThisCycle || rule.countdownActed === true || windowShut(rule);
}

/**
 * Fold one poll's readings into every rule, and report what crossed.
 *
 * Returns the rules as they now stand — the caller persists them. Rolling a cycle
 * and latching a trip are both state a later call has to see, and a host whose
 * worker is torn down between polls has nowhere else to keep them.
 *
 * A rule with no reading this poll is still rolled: its device is offline, its
 * counter is frozen at the last value seen, and a cycle that will not roll for an
 * absent device is one that never lets go of it.
 *
 * Counters are folded and cycles rolled for every rule before any allowance is
 * tested: a shared allowance tested against a sum still holding another member's
 * pre-roll usage reads as over at the moment it starts over.
 *
 * Nothing here writes to a router or decides that a device is free. Latches are
 * cleared as each measure turns over, and whether that leaves the device held is
 * asked of the whole rule set afterwards.
 */
export function evaluateMeters(
  rules: readonly MeterRule[],
  readings: readonly MeterReading[],
  nowMs: number,
): { rules: MeterRule[]; transitions: MeterTransition[] } {
  const byKey = new Map(readings.map((reading) => [reading.clientKey, reading]));
  const transitions: MeterTransition[] = [];

  const rolled = rules.map((current) => {
    let rule = { ...current };
    const reading = byKey.get(rule.clientKey);
    if (reading) {
      rule.observedRx = reading.lifetimeRx;
      rule.observedTx = reading.lifetimeTx;
    }

    if (scheduleActive(rule.schedule) && nowMs >= (rule.windowEndMs ?? 0)) {
      const segment = scheduleSegment(rule.schedule, nowMs);
      rule = {
        ...rule,
        windowEndMs: segment.endMs,
        windowBlocked: segment.blocked,
        windowActed: false,
      };
    }

    if (nowMs >= rule.periodEndMs) {
      const bounds = periodBounds(rule.cycle, nowMs);
      rule = {
        ...rule,
        anchorRx: rule.observedRx,
        anchorTx: rule.observedTx,
        periodStartMs: cycleStartMs(rule.cycle, bounds, nowMs),
        periodEndMs: bounds.endMs,
        actedThisCycle: false,
      };
    }
    return rule;
  });

  const sharedUsage = sharedUsageByGroup(rolled);

  const next = rolled.map((current) => {
    let rule = current;
    const charged = chargedBytes(rule, sharedUsage);

    // One announcement per rule, whichever of its measures runs out first: a
    // second alert for a device that is already quiet says nothing the first did
    // not. Announced whether or not a pause follows — only enforcement turns on
    // autoPause, and a watch-only rule still reaches what it measures.
    //
    // The two latches that announce, rather than every latch: a shut window says
    // nothing, so it must not count as an announcement already made. Traffic can
    // outlive it — a watch-only rule, or one whose pause never landed — and the
    // allowance it spends there is still worth saying.
    let held = rule.actedThisCycle || rule.countdownActed === true;
    const reach = () => {
      if (held) return;
      held = true;
      rule = { ...rule, reachedAtMs: nowMs };
      transitions.push({
        kind: "reached",
        clientKey: rule.clientKey,
        usageBytes: charged,
        atMs: nowMs,
        rule,
      });
    };

    if (!rule.actedThisCycle && allocationSpent(rule, sharedUsage)) {
      rule = { ...rule, actedThisCycle: true };
      reach();
    }

    if (rule.countdownActed !== true && countdownSpent(rule, nowMs)) {
      rule = { ...rule, countdownActed: true };
      reach();
    }

    // Latched but never announced: a window closing at 8pm is the rule working,
    // and one alert a night would bury the allowance alerts that do mean
    // something. The pause it owes is derived from the latch like any other.
    if (windowShut(rule) && rule.windowActed !== true) rule = { ...rule, windowActed: true };

    // Off the stamp, not the pause: a watch-only rule and one whose write failed
    // announce the same way, so they have to stop announcing the same way.
    if (rule.reachedAtMs !== undefined && nowMs - rule.reachedAtMs >= METER_ALERT_HOLD_MS) {
      rule = { ...rule, reachedAtMs: undefined };
      transitions.push({
        kind: "expired",
        clientKey: rule.clientKey,
        usageBytes: charged,
        atMs: nowMs,
        rule,
      });
    }

    return rule;
  });

  return { rules: next, transitions };
}

/**
 * Transitions with the members of one group reduced to the first that crossed.
 *
 * Every member is still held; this reduces what is said about them to the one
 * thing that happened.
 */
export function collapseGroupAnnouncements(
  transitions: readonly MeterTransition[],
): MeterTransition[] {
  const seen = new Set<string>();
  return transitions.filter((transition) => {
    if (!announcesAsGroup(transition.rule)) return true;
    const key = `${announcementSubject(transition.rule)}:${transition.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A recorder's current device roster, as rule reconciliation reads it. */
export interface MeterRoster {
  /** Every device key the recorder holds counters for. */
  keys: readonly string[];
  /** The key a device answers to now, following any identity merge. */
  resolveKey: (key: string) => string;
}

/**
 * Move rules onto the identities their devices now answer to, dropping any left
 * on a bucket the recorder no longer holds.
 *
 * A reissued id is the same device, so a rule follows the alias the way the
 * odometer folds the counters. Where two rules land on one key, the one whose
 * terms were set most recently is the standing intent and wins.
 *
 * An empty roster is a recorder that has folded no reading yet, never evidence
 * that every device is gone, so nothing is dropped against one.
 */
export function resolveRuleKeys(rules: readonly MeterRule[], roster: MeterRoster): MeterRule[] {
  if (roster.keys.length === 0) return [...rules];
  const known = new Set(roster.keys);
  const kept = new Map<string, MeterRule>();
  for (const rule of rules) {
    const clientKey = roster.resolveKey(rule.clientKey);
    if (!known.has(clientKey)) continue;
    const moved = clientKey === rule.clientKey ? rule : { ...rule, clientKey };
    // Per rule, not per device: a device answers to as many rules as name it, and
    // deduping by device would silently drop all but one of them. Two rules can
    // still land on one key when a merge brings two identities of one device
    // under a single group, and there the standing intent wins.
    const held = kept.get(ruleKey(moved));
    if (held && (held.updatedMs ?? 0) >= (rule.updatedMs ?? 0)) continue;
    kept.set(ruleKey(moved), moved);
  }
  return [...kept.values()];
}

/**
 * A rule for a device, opening its first cycle now.
 *
 * `lifetimeRx/Tx` anchor it to the counter as it reads at this moment, so a rule
 * written today measures from today rather than inheriting whatever the device
 * had already spent.
 */
export interface MeterRuleTerms {
  clientKey: string;
  allocationBytes: number;
  autoPause?: boolean;
  cycle: MeterCycle;
  lifetimeRx: number;
  lifetimeTx: number;
  nowMs: number;
  /** Set when the rule is a group's, absent when the device carries its own. */
  groupId?: string;
  sharedAllowance?: boolean;
  /** Adds a countdown, clamped to a day. Rides alongside the allowance rather
   *  than replacing it. */
  countdownMs?: number;
  /** The hours this rule lets the device online. Rides alongside the other two
   *  rather than replacing them — a rule can keep all three. */
  schedule?: Schedule;
}

/**
 * What tells one rule from another.
 *
 * A device can be named by several groups and hold a rule for each, so the device
 * alone no longer identifies one. Derived rather than stored: a key that is a
 * function of what the rule already says cannot drift from it.
 */
export function ruleKey(rule: Pick<MeterRule, "clientKey" | "groupId">): string {
  return `${rule.groupId ?? "device"}:${rule.clientKey}`;
}

/** Seeded on the write rather than left to the first turnover, which on a
 *  nightly window is the following evening. */
function openingWindow(
  schedule: Schedule | undefined,
  nowMs: number,
): Pick<MeterRule, "schedule" | "windowEndMs" | "windowBlocked" | "windowActed"> {
  if (!scheduleActive(schedule)) return {};
  const segment = scheduleSegment(schedule, nowMs);
  return {
    schedule,
    windowEndMs: segment.endMs,
    windowBlocked: segment.blocked,
    windowActed: false,
  };
}

/** A countdown as it is stored: whole milliseconds, and never longer than the cap
 *  the form offers. The cycle beside it is left alone — the countdown keeps its
 *  own start, so an allowance can go on rolling underneath it. */
function termsOf(options: MeterRuleTerms): MeterRuleTerms {
  if (options.countdownMs === undefined) return options;
  return {
    ...options,
    countdownMs: Math.min(MAX_COUNTDOWN_MS, Math.max(1, Math.round(options.countdownMs))),
  };
}

export function createRule(input: MeterRuleTerms): MeterRule {
  const options = termsOf(input);
  const bounds = periodBounds(options.cycle, options.nowMs);
  return {
    clientKey: options.clientKey,
    allocationBytes: options.allocationBytes,
    autoPause: options.autoPause ?? true,
    cycle: options.cycle,
    anchorRx: options.lifetimeRx,
    anchorTx: options.lifetimeTx,
    observedRx: options.lifetimeRx,
    observedTx: options.lifetimeTx,
    periodStartMs: cycleStartMs(options.cycle, bounds, options.nowMs),
    periodEndMs: bounds.endMs,
    actedThisCycle: false,
    updatedMs: options.nowMs,
    createdMs: options.nowMs,
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
    ...(options.sharedAllowance ? { sharedAllowance: true } : {}),
    ...(options.countdownMs === undefined
      ? {}
      : {
          countdownMs: options.countdownMs,
          countdownStartMs: options.nowMs,
          countdownActed: false,
        }),
    ...openingWindow(options.schedule, options.nowMs),
  };
}

/**
 * The rule an edit leaves behind: the anchors stand and a changed cycle moves
 * only its boundaries. Clearing the count is restartCycle's job.
 *
 * `chargedBytes` is what the new allowance is judged against. Left out on a
 * member of a shared allowance, it re-arms while its group is still over.
 */
export function upsertRule(
  existing: MeterRule | undefined,
  input: MeterRuleTerms & { chargedBytes?: number },
): MeterRule {
  const options = { ...termsOf(input), chargedBytes: input.chargedBytes };
  if (!existing) return createRule(options);
  const movesBoundaries = JSON.stringify(existing.cycle) !== JSON.stringify(options.cycle);
  const bounds = movesBoundaries ? periodBounds(options.cycle, options.nowMs) : null;
  // A countdown someone has just set starts from now, rather than counting the new
  // duration off a start the old one had already half spent. Re-saving the same
  // duration counts: it is the only way to say "start that again" about a timer
  // that has already run out.
  const reTimed = options.countdownMs !== undefined;
  // Carrying the old boundary across would hold a device shut until a window
  // that no longer exists would have opened.
  const reTimetabled =
    JSON.stringify(existing.schedule ?? null) !== JSON.stringify(options.schedule ?? null);
  const rule: MeterRule = {
    ...existing,
    allocationBytes: options.allocationBytes,
    autoPause: options.autoPause ?? existing.autoPause,
    cycle: options.cycle,
    updatedMs: options.nowMs,
    ...(bounds
      ? {
          periodStartMs: cycleStartMs(options.cycle, bounds, options.nowMs),
          periodEndMs: bounds.endMs,
        }
      : {}),
    ...(options.groupId === undefined ? { groupId: undefined } : { groupId: options.groupId }),
    ...(options.sharedAllowance ? { sharedAllowance: true } : { sharedAllowance: undefined }),
    ...(reTimed
      ? {
          countdownMs: options.countdownMs,
          countdownStartMs: options.nowMs,
          countdownActed: false,
        }
      : { countdownMs: undefined, countdownStartMs: undefined, countdownActed: undefined }),
    ...(reTimetabled
      ? {
          schedule: undefined,
          windowEndMs: undefined,
          windowBlocked: undefined,
          windowActed: undefined,
          ...openingWindow(options.schedule, options.nowMs),
        }
      : {}),
  };
  // Moving between a device and a group moves which key the announcement is
  // filed under, and a stamp carried across would retire under a key it was never
  // raised on. The caller clears the old one.
  if (announcementSubject(rule) !== announcementSubject(existing)) rule.reachedAtMs = undefined;
  // An allowance raised past what has been spent against it is no longer reached,
  // so that measure arms again. The other two answer for themselves: a countdown
  // has just been restarted, and a window is not something an edit can open.
  if ((options.chargedBytes ?? usageBytes(rule)) < rule.allocationBytes)
    return { ...rule, actedThisCycle: false };
  return rule;
}

/**
 * Start everything a rule measures over from now — the top-up for a cycle that
 * does not roll on its own, and the way back for one whose limit was set too low.
 *
 * The timetable is not restarted, because a timetable is not something anyone can
 * be given more of: its hours are the hours, and a restart that opened them would
 * be a way past the rule rather than a fresh start under it.
 */
export function restartCycle(rule: MeterRule, nowMs: number): MeterRule {
  const bounds = periodBounds(rule.cycle, nowMs);
  return {
    ...rule,
    anchorRx: rule.observedRx,
    anchorTx: rule.observedTx,
    periodStartMs: cycleStartMs(rule.cycle, bounds, nowMs),
    periodEndMs: bounds.endMs,
    actedThisCycle: false,
    // Left standing, the stamp outlives the reading behind it and every surface
    // goes on reporting a device as over a limit it has just been given back.
    reachedAtMs: undefined,
    ...(rule.countdownMs === undefined ? {} : { countdownStartMs: nowMs, countdownActed: false }),
    ...openingWindow(rule.schedule, nowMs),
  };
}
