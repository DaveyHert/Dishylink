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
 * Fold one poll's readings into every rule, and report what crossed.
 *
 * Returns the rules as they now stand — the caller persists them. Rolling a cycle
 * and latching a trip are both state a later call has to see, and a host whose
 * worker is torn down between polls has nowhere else to keep them.
 *
 * A rule with no reading this poll is still rolled: its device is offline, its
 * counter is frozen at the last value seen, and a cycle that will not roll for an
 * absent device is one that never releases the pause it applied.
 */
export function evaluateMeters(
  rules: readonly MeterRule[],
  readings: readonly MeterReading[],
  nowMs: number,
): { rules: MeterRule[]; transitions: MeterTransition[] } {
  const byKey = new Map(readings.map((reading) => [reading.clientKey, reading]));
  const transitions: MeterTransition[] = [];
  const next: MeterRule[] = [];

  for (const current of rules) {
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

    // Reaching an allowance is announced whether or not a pause follows it; only
    // enforcement turns on autoPause, and a watch-only rule has no write pending.
    if (!rule.actedThisCycle && usageBytes(rule) >= rule.allocationBytes) {
      rule = {
        ...rule,
        actedThisCycle: true,
        reachedAtMs: nowMs,
        ...(rule.autoPause ? { pauseState: "pending" } : {}),
      };
      transitions.push({
        kind: "reached",
        clientKey: rule.clientKey,
        usageBytes: usageBytes(rule),
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
        usageBytes: usageBytes(rule),
        atMs: nowMs,
        rule,
      });
    }

    next.push(rule);
  }

  return { rules: next, transitions };
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
  return rules.filter(
    (rule) =>
      rule.autoPause &&
      (rule.pauseState === "failed" || rule.pauseState === "pending") &&
      nowMs - (rule.pauseCheckedMs ?? 0) >= retryMs &&
      usageBytes(rule) >= rule.allocationBytes,
  );
}

/** The rule is the only record that a device is still paused, so it stays
 *  "applied" until a write says otherwise. */
export function stalledReleases(
  rules: readonly MeterRule[],
  nowMs: number,
  retryMs: number,
): MeterRule[] {
  return rules.filter(
    (rule) =>
      rule.pauseState === "applied" &&
      usageBytes(rule) < rule.allocationBytes &&
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
export function createRule(options: {
  clientKey: string;
  allocationBytes: number;
  autoPause?: boolean;
  cycle: MeterCycle;
  lifetimeRx: number;
  lifetimeTx: number;
  nowMs: number;
}): MeterRule {
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
  };
}

/** The rule an edit leaves behind: the anchors stand and a changed cycle moves
 *  only its boundaries. Clearing the count is restartCycle's job. */
export function upsertRule(
  existing: MeterRule | undefined,
  options: {
    clientKey: string;
    allocationBytes: number;
    autoPause?: boolean;
    cycle: MeterCycle;
    lifetimeRx: number;
    lifetimeTx: number;
    nowMs: number;
  },
): MeterRule {
  if (!existing) return createRule(options);
  const movesBoundaries = JSON.stringify(existing.cycle) !== JSON.stringify(options.cycle);
  const bounds = movesBoundaries ? periodBounds(options.cycle, options.nowMs) : null;
  const rule = {
    ...existing,
    allocationBytes: options.allocationBytes,
    autoPause: options.autoPause ?? existing.autoPause,
    cycle: options.cycle,
    updatedMs: options.nowMs,
    ...(bounds ? { periodStartMs: bounds.startMs, periodEndMs: bounds.endMs } : {}),
  };
  // An allowance raised past what the device has spent is no longer reached, so
  // the rule arms again.
  if (usageBytes(rule) < rule.allocationBytes)
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
