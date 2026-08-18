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
  /** Follows the Starlink account's own billing cycle, which is not the calendar
   *  month and is the one a reseller bills against. Falls back to the 1st when no
   *  account cycle is to hand — a standalone recorder cannot reach one. */
  | { kind: "billing" }
  /** A fixed allowance that never rolls: sold once, topped up by hand. */
  | { kind: "once" };

/** How a device's pause stands with the router, so a write that failed is not
 *  silently reported as an enforced limit. */
export type MeterPauseState = "none" | "pending" | "applied" | "failed";

export interface MeterRule {
  clientKey: string;
  /** The cycle's budget. Also what the card measures against. */
  allocationBytes: number;
  /** Where the pause trips. Defaults to the allocation and may sit below it, to
   *  stop short of the budget rather than on it. */
  pauseAtBytes: number;
  /** False leaves the rule inert: usage is still tracked and the cycle still
   *  rolls, but nothing is paused and nothing is announced. */
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
}

export interface MeterTransition {
  /** `reached` — the allowance is spent and the device should be paused.
   *  `released` — the cycle rolled on a device this rule had paused. */
  kind: "reached" | "released";
  clientKey: string;
  /** Bytes used in the cycle that just ended, or the one still running. */
  usageBytes: number;
  atMs: number;
  rule: MeterRule;
}

/** The account's current billing cycle, when the caller has one. */
export interface BillingCycle {
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

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

/**
 * The cycle `atMs` falls in.
 *
 * `billingCycle` is passed rather than fetched: the account's dates arrive over
 * the cloud, and a recorder running without one still has to answer.
 */
export function periodBounds(
  cycle: MeterCycle,
  atMs: number,
  billingCycle?: BillingCycle,
): { startMs: number; endMs: number } {
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
      if (billingCycle) return { startMs: billingCycle.startMs, endMs: billingCycle.endMs };
      return periodBounds({ kind: "monthly", day: 1 }, atMs);
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
  options: { billingCycle?: BillingCycle } = {},
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
      const bounds = periodBounds(rule.cycle, nowMs, options.billingCycle);
      const released = rule.pauseState === "applied";
      rule = {
        ...rule,
        anchorRx: rule.observedRx,
        anchorTx: rule.observedTx,
        periodStartMs: bounds.startMs,
        periodEndMs: bounds.endMs,
        actedThisCycle: false,
        pauseState: "none",
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

    if (rule.autoPause && !rule.actedThisCycle && usageBytes(rule) >= rule.pauseAtBytes) {
      rule = { ...rule, actedThisCycle: true, pauseState: "pending" };
      transitions.push({
        kind: "reached",
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
 * A rule for a device, opening its first cycle now.
 *
 * `lifetimeRx/Tx` anchor it to the counter as it reads at this moment, so a rule
 * written today measures from today rather than inheriting whatever the device
 * had already spent.
 */
export function createRule(options: {
  clientKey: string;
  allocationBytes: number;
  pauseAtBytes?: number;
  autoPause?: boolean;
  cycle: MeterCycle;
  lifetimeRx: number;
  lifetimeTx: number;
  nowMs: number;
  billingCycle?: BillingCycle;
}): MeterRule {
  const bounds = periodBounds(options.cycle, options.nowMs, options.billingCycle);
  return {
    clientKey: options.clientKey,
    allocationBytes: options.allocationBytes,
    pauseAtBytes: options.pauseAtBytes ?? options.allocationBytes,
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
  };
}

/** Start a rule's allowance over from now — the top-up for a cycle that does not
 *  roll on its own, and the way back for one whose limit was set too low. */
export function restartCycle(
  rule: MeterRule,
  nowMs: number,
  billingCycle?: BillingCycle,
): MeterRule {
  const bounds = periodBounds(rule.cycle, nowMs, billingCycle);
  return {
    ...rule,
    anchorRx: rule.observedRx,
    anchorTx: rule.observedTx,
    periodStartMs: rule.cycle.kind === "once" ? nowMs : bounds.startMs,
    periodEndMs: bounds.endMs,
    actedThisCycle: false,
    pauseState: "none",
  };
}
