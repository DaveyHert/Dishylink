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

/** How a device's pause stands with the router, so a write that failed is not
 *  silently reported as an enforced limit. */
export type MeterPauseState = "none" | "pending" | "applied" | "failed";

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
  /** Whether this cycle has already been acted on. "Acted", not "over": a device
   *  the user unpauses by hand stays unpaused, rather than being paused again on
   *  the next reading. */
  actedThisCycle: boolean;
  pauseState: MeterPauseState;
  /** When the pause was last attempted, so a host that retries a failed write
   *  can space its attempts. */
  pauseCheckedMs?: number;
  /** Why the last attempt failed. */
  pauseError?: string;
  /** When this cycle's allowance was reached, for as long as the announcement
   *  stands. Absent once it has retired — and absent on a rule stored before the
   *  stamp existed, which reads as one whose announcement is already over. */
  reachedAtMs?: number;
  /** When its terms were last set. Absent on a rule written before the stamp
   *  existed, which loses to any rule carrying one. */
  updatedMs?: number;
  /** The group this rule was projected from, absent when the device carries its
   *  own. Joining a group replaces the device's rule, so there is only ever one. */
  groupId?: string;
  /** Charges this member the group's summed usage rather than its own, so the
   *  members of one allowance cross together. */
  sharedAllowance?: boolean;
  /** A countdown rather than an allowance: the device is paused this long after
   *  the cycle opened, whatever it has spent. Capped at a day, and always on a
   *  cycle that does not roll, so the clock it counts is one anyone can see. */
  countdownMs?: number;
}

export interface MeterTransition {
  /** `reached` — the allowance is spent and the device should be paused.
   *  `expired` — the announcement has stood its minute and retires; it reaches
   *  no router. `released` — the cycle rolled on a device this rule had paused,
   *  which owes an unpause and nothing else. */
  kind: "reached" | "expired" | "released";
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

/** How long a countdown has left, or null on a rule that is not one. */
export function countdownLeftMs(rule: MeterRule, nowMs: number): number | null {
  if (rule.countdownMs === undefined) return null;
  return Math.max(0, rule.periodStartMs + rule.countdownMs - nowMs);
}

/**
 * Whether a rule has reached what it measures.
 *
 * The one place the two kinds of rule differ. A countdown is spent when its time
 * is up, an allowance when the bytes charged to it reach it, and every caller
 * downstream — the trip, the retries, the release — asks this rather than
 * comparing either itself.
 */
export function allowanceSpent(
  rule: MeterRule,
  nowMs: number,
  sharedUsage: ReadonlyMap<string, number>,
): boolean {
  if (rule.countdownMs !== undefined) return nowMs >= rule.periodStartMs + rule.countdownMs;
  return chargedBytes(rule, sharedUsage) >= rule.allocationBytes;
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
 * absent device is one that never releases the pause it applied.
 *
 * Counters are folded and cycles rolled for every rule before any allowance is
 * tested: a shared allowance tested against a sum still holding another member's
 * pre-roll usage reads as over at the moment it starts over.
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

    if (nowMs >= rule.periodEndMs) {
      const spent = usageBytes(rule);
      const bounds = periodBounds(rule.cycle, nowMs);
      const released = rule.pauseState === "applied";
      rule = {
        ...rule,
        anchorRx: rule.observedRx,
        anchorTx: rule.observedTx,
        periodStartMs: bounds.startMs,
        periodEndMs: bounds.endMs,
        actedThisCycle: false,
        pauseState: "none",
        pauseError: undefined,
      };
      // Only a pause this rule applied is lifted. A device the user paused by
      // hand is theirs to unpause, and a cycle rolling is not an answer to it.
      if (released)
        transitions.push({
          kind: "released",
          clientKey: rule.clientKey,
          usageBytes: spent,
          atMs: nowMs,
          rule,
        });
    }
    return rule;
  });

  const sharedUsage = sharedUsageByGroup(rolled);

  const next = rolled.map((current) => {
    let rule = current;
    const charged = chargedBytes(rule, sharedUsage);

    // Reaching an allowance is announced whether or not a pause follows it; only
    // enforcement turns on autoPause, and a watch-only rule has no write pending.
    if (!rule.actedThisCycle && allowanceSpent(rule, nowMs, sharedUsage)) {
      rule = {
        ...rule,
        actedThisCycle: true,
        reachedAtMs: nowMs,
        ...(rule.autoPause ? { pauseState: "pending" } : {}),
      };
      transitions.push({
        kind: "reached",
        clientKey: rule.clientKey,
        usageBytes: charged,
        atMs: nowMs,
        rule,
      });
    }

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
 * Transitions as announcements, with the members of one group reduced to the
 * first that crossed.
 *
 * Every member is still paused, so this is applied to what is announced and never
 * to what is written to the router.
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

/**
 * Rules whose pause is owed another attempt.
 *
 * A write in flight settles in seconds, so a "pending" older than the whole retry
 * window never came back and is as stalled as one that failed outright.
 */
export function stalledPauses(
  rules: readonly MeterRule[],
  nowMs: number,
  retryMs: number,
): MeterRule[] {
  const sharedUsage = sharedUsageByGroup(rules);
  return rules.filter(
    (rule) =>
      rule.autoPause &&
      (rule.pauseState === "failed" || rule.pauseState === "pending") &&
      nowMs - (rule.pauseCheckedMs ?? 0) >= retryMs &&
      allowanceSpent(rule, nowMs, sharedUsage),
  );
}

/** The rule is the only record that a device is still paused, so it stays
 *  "applied" until a write says otherwise. */
export function stalledReleases(
  rules: readonly MeterRule[],
  nowMs: number,
  retryMs: number,
): MeterRule[] {
  const sharedUsage = sharedUsageByGroup(rules);
  return rules.filter(
    (rule) =>
      rule.pauseState === "applied" &&
      !allowanceSpent(rule, nowMs, sharedUsage) &&
      nowMs - (rule.pauseCheckedMs ?? 0) >= retryMs,
  );
}

/** The router is the authority on whether a device is paused, so where it and a
 *  rule disagree the rule is the stale half. A key the poll did not carry is "not
 *  asked", never "not paused". */
export function releasedByHand(
  rules: readonly MeterRule[],
  blocked: ReadonlyMap<string, boolean>,
): MeterRule[] {
  return rules.filter(
    (rule) => rule.pauseState === "applied" && blocked.get(rule.clientKey) === false,
  );
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
    const held = kept.get(clientKey);
    if (held && (held.updatedMs ?? 0) >= (rule.updatedMs ?? 0)) continue;
    kept.set(clientKey, clientKey === rule.clientKey ? rule : { ...rule, clientKey });
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
  /** Makes this a countdown. Clamped to a day, and the cycle is forced to one
   *  that does not roll, so the countdown runs from a start that stays put. */
  countdownMs?: number;
}

/** A timer counts from its own start, so it is only ever written on a cycle that
 *  does not move that start under it. */
function termsOf(options: MeterRuleTerms): MeterRuleTerms & { countdownMs?: number } {
  if (options.countdownMs === undefined) return options;
  return {
    ...options,
    cycle: { kind: "once" },
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
    periodStartMs: options.cycle.kind === "once" ? options.nowMs : bounds.startMs,
    periodEndMs: bounds.endMs,
    actedThisCycle: false,
    pauseState: "none",
    updatedMs: options.nowMs,
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
    ...(options.sharedAllowance ? { sharedAllowance: true } : {}),
    ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
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
  // A countdown someone has just re-timed starts from now, rather than counting
  // the new duration off a start the old one had already half spent.
  const reTimed = options.countdownMs !== undefined && options.countdownMs !== existing.countdownMs;
  const rule: MeterRule = {
    ...existing,
    allocationBytes: options.allocationBytes,
    autoPause: options.autoPause ?? existing.autoPause,
    cycle: options.cycle,
    updatedMs: options.nowMs,
    ...(bounds ? { periodStartMs: bounds.startMs, periodEndMs: bounds.endMs } : {}),
    ...(reTimed ? { periodStartMs: options.nowMs } : {}),
    ...(options.groupId === undefined ? { groupId: undefined } : { groupId: options.groupId }),
    ...(options.sharedAllowance ? { sharedAllowance: true } : { sharedAllowance: undefined }),
    ...(options.countdownMs === undefined
      ? { countdownMs: undefined }
      : { countdownMs: options.countdownMs }),
  };
  // Moving between a device and a group moves which key the announcement is
  // filed under, and a stamp carried across would retire under a key it was never
  // raised on. The caller clears the old one.
  if (announcementSubject(rule) !== announcementSubject(existing)) rule.reachedAtMs = undefined;
  // An allowance raised past what has been spent against it, or a countdown given
  // more time, is no longer reached, so the rule arms again.
  if (
    rule.countdownMs !== undefined
      ? (countdownLeftMs(rule, options.nowMs) ?? 0) > 0
      : (options.chargedBytes ?? usageBytes(rule)) < rule.allocationBytes
  )
    return { ...rule, actedThisCycle: false, pauseState: "none", pauseError: undefined };
  // Nothing retries a rule that no longer enforces, so it holds no owed write. A
  // pause already applied stands: the device is held until something lifts it.
  if (!rule.autoPause && rule.pauseState !== "applied")
    return { ...rule, pauseState: "none", pauseError: undefined };
  return rule;
}

/** Start a rule's allowance over from now — the top-up for a cycle that does not
 *  roll on its own, and the way back for one whose limit was set too low. */
export function restartCycle(rule: MeterRule, nowMs: number): MeterRule {
  const bounds = periodBounds(rule.cycle, nowMs);
  return {
    ...rule,
    anchorRx: rule.observedRx,
    anchorTx: rule.observedTx,
    periodStartMs: rule.cycle.kind === "once" ? nowMs : bounds.startMs,
    periodEndMs: bounds.endMs,
    actedThisCycle: false,
    pauseState: "none",
    pauseError: undefined,
  };
}
