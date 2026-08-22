import { scheduleActive, scheduleGoverns, type Schedule } from "@core/schedule";

export type RuleMeasure = "schedule" | "timer" | "allowance";

/** Where a reading stops being comfortable. Shared so the bar and the ring cannot
 *  turn amber at different points on the same rule. */
export const NEARING_LIMIT = 0.9;

export function meterTone(spent: number, paused: boolean): string {
  if (paused || spent >= 1) return "bg-[var(--status-critical)]";
  return spent >= NEARING_LIMIT ? "bg-[var(--accent)]" : "bg-[var(--series-down)]";
}

interface Measured {
  countdownMs?: number;
  schedule?: Schedule;
}

/** The rule's subject, and so what a card leads with. */
export function leadingMeasure(rule: Measured): RuleMeasure {
  if (rule.countdownMs !== undefined) return "timer";
  return scheduleActive(rule.schedule) ? "schedule" : "allowance";
}

/** A timetable sitting out the day rather than running: it neither allows nor
 *  blocks, so "Active" and "Closes" both misread it. */
export function scheduleDormant(rule: Measured, nowMs: number): boolean {
  return scheduleActive(rule.schedule) && !scheduleGoverns(rule.schedule, nowMs);
}

/** Which measure is doing the holding — not always the one the rule leads with,
 *  since a rule with a bedtime can still be paused for running out of bytes. */
export function pauseCause(rule: Measured & { windowBlocked?: boolean }): RuleMeasure {
  if (rule.windowBlocked && scheduleActive(rule.schedule)) return "schedule";
  return rule.countdownMs !== undefined ? "timer" : "allowance";
}
