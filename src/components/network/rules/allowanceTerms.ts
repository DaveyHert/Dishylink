// The editable terms of one allowance, and the wording that reads them back.
// Kept apart from the components that render them so fast refresh still works.

import { useState } from "react";
import { formatDuration, MAX_COUNTDOWN_MS, splitDuration, type MeterCycle } from "@core/dataMeter";
import type { Schedule } from "@core/schedule";
import type { ScheduleDraft } from "./scheduleTerms";

export { formatDuration, splitDuration };

export const GB = 1_000_000_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/** The day of the month the account's own cycle turns over, or null with no
 *  account connected. Read as a local date, since it feeds local midnights. */
export function billingDayOf(cycles: { startDate: string }[] | undefined): number | null {
  const newest = cycles?.[cycles.length - 1];
  if (!newest?.startDate) return null;
  const day = new Date(newest.startDate).getDate();
  return Number.isFinite(day) && day >= 1 ? day : null;
}

export const CYCLE_OPTIONS: { label: string; value: MeterCycle["kind"] }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Starlink billing", value: "billing" },
  { label: "One-off", value: "once" },
];

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "in 5 days" / "tomorrow" / "in 3 hours" — how long this cycle has left. */
export function endsIn(endMs: number, nowMs: number): string | null {
  if (!Number.isFinite(endMs)) return null;
  const hours = Math.max(0, Math.round((endMs - nowMs) / HOUR_MS));
  if (hours < 1) return "ends within the hour";
  if (hours < 24) return `ends in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ends tomorrow" : `ends in ${days} days`;
}

export function timeLeft(endMs: number, nowMs: number): string | null {
  if (!Number.isFinite(endMs)) return null;
  const minutes = Math.max(0, Math.round((endMs - nowMs) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function cycleLabel(cycle: MeterCycle): string {
  switch (cycle.kind) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "custom":
      return `Every ${cycle.days} days`;
    case "billing":
      return "Starlink billing";
    case "once":
      return "One-off";
  }
}

/** GB as the field shows it: one decimal, and none when it is round. */
export function gigabytes(bytes: number): string {
  return (bytes / GB).toFixed(1).replace(/\.0$/, "");
}

export function ringReading(bytes: number): { value: string; unit: string } {
  const megabytes = Math.round(bytes / 1e6);
  if (megabytes < 1000) return { value: String(megabytes), unit: "MB USED" };
  return { value: gigabytes(bytes), unit: "GB USED" };
}

export const CEILING_RUNGS_GB = [10, 25, 50, 100, 250, 500, 1000];

export function ceilingLabel(gigabyteValue: number): string {
  return gigabyteValue >= 1000 ? `${gigabyteValue / 1000} TB` : `${gigabyteValue} GB`;
}

export const stepButtonClass =
  "grid h-3 w-6 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-90";

export function ceilingFor(gigabyteValue: number): number {
  return CEILING_RUNGS_GB.find((rung) => rung > gigabyteValue) ?? Math.ceil(gigabyteValue);
}

export function stepCeiling(current: number, gigabyteValue: number, delta: 1 | -1): number {
  const reachable = CEILING_RUNGS_GB.filter((rung) => rung > gigabyteValue);
  if (reachable.length === 0) return ceilingFor(gigabyteValue);
  const index = reachable.indexOf(current);
  if (index === -1) return reachable[0];
  return reachable[(index + delta + reachable.length) % reachable.length];
}

export function clampDay(dayOfMonth: number): number {
  return Math.min(31, Math.max(1, Math.floor(dayOfMonth)));
}

export function stepDay(dayOfMonth: number, delta: 1 | -1): number {
  return ((dayOfMonth - 1 + delta + 31) % 31) + 1;
}

export function stepFor(ceiling: number): number {
  if (ceiling <= 25) return 0.1;
  if (ceiling <= 100) return 0.5;
  if (ceiling <= 1000) return 5;
  return 25;
}

/** The clock time a countdown running from now would reach. */
export function endsAtLabel(remainingMs: number, nowMs: number): string {
  return new Date(nowMs + remainingMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface MemberCandidate {
  clientKey: string;
  name: string;
  /** For the device-type icon and vendor line a picker row shows, same as the
   *  Network tab draws them. */
  macAddress: string;
  /** Whether the router is reporting this device right now. A tag on the row and
   *  the band it sorts into, never a condition on being pickable: a rule on an
   *  absent device still rolls its cycle and still releases its pause. */
  active: boolean;
  lastSeenMs: number;
}

/** Devices in the order a picker holds them still: active first, then by name.
 *  Ordering by traffic or last seen re-sorts the list under the cursor. */
export function orderedCandidates(candidates: readonly MemberCandidate[]): MemberCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (!a.active && a.lastSeenMs !== b.lastSeenMs) return b.lastSeenMs - a.lastSeenMs;
    return a.name.localeCompare(b.name);
  });
}

export interface AllowanceDraft {
  allocationText: string;
  setAllocationText: (next: string) => void;
  allocationBytes: number;
  autoPause: boolean;
  setAutoPause: (next: boolean) => void;
  cycle: MeterCycle;
  kind: MeterCycle["kind"];
  setKind: (next: MeterCycle["kind"]) => void;
  billingDay: number | null;
  ceiling: number;
  setCeiling: (next: number) => void;
  weekday: number;
  setWeekday: (next: number) => void;
  dayText: string;
  setDayText: (next: string) => void;
  day: number;
  /** True while the rule counts down rather than measuring an allowance. */
  timer: boolean;
  setTimer: (next: boolean) => void;
  /** The countdown as set, or undefined on an allowance rule. */
  countdownMs: number | undefined;
  hoursText: string;
  setHoursText: (next: string) => void;
  minutesText: string;
  setMinutesText: (next: string) => void;
}

function cycleFor(
  kind: MeterCycle["kind"],
  weekday: number,
  day: number,
  startedMs: number,
  billingDay: number | null,
): MeterCycle {
  if (kind === "weekly") return { kind, weekday };
  if (kind === "monthly") return { kind, day };
  if (kind === "custom") return { kind, days: 30, startMs: startedMs };
  if (kind === "billing") return { kind, day: billingDay ?? day };
  return { kind };
}

/** The editable terms of one allowance. `startedMs` seeds a custom cycle's first
 *  boundary; without `billingDay` the option needing it is refused. */
export function useAllowanceDraft(options: {
  allocationBytes?: number;
  autoPause?: boolean;
  cycle?: MeterCycle;
  countdownMs?: number;
  billingDay: number | null;
  startedMs: number;
}): AllowanceDraft {
  const { cycle: stored, billingDay, startedMs } = options;
  const opening = splitDuration(options.countdownMs ?? HOUR_MS);
  const [timer, setTimer] = useState(options.countdownMs !== undefined);
  const [hoursText, setHoursText] = useState(String(opening.hours));
  const [minutesText, setMinutesText] = useState(String(opening.minutes));
  const [allocationText, setAllocationText] = useState(
    options.allocationBytes === undefined ? "50" : gigabytes(options.allocationBytes),
  );
  const [ceiling, setCeiling] = useState(() =>
    ceilingFor(options.allocationBytes === undefined ? 50 : options.allocationBytes / GB),
  );
  const [autoPause, setAutoPause] = useState(options.autoPause ?? true);
  const [kind, setKind] = useState<MeterCycle["kind"]>(stored?.kind ?? "monthly");
  const [weekday, setWeekday] = useState(stored?.kind === "weekly" ? stored.weekday : 1);
  // Billing seeds this too, so an edit made with no account reachable saves the
  // rule's own date back rather than the 1st.
  const [dayText, setDayText] = useState(
    stored?.kind === "monthly" || stored?.kind === "billing" ? String(stored.day) : "1",
  );

  const day = clampDay(Number(dayText) || 1);
  const countdownMs = Math.min(
    MAX_COUNTDOWN_MS,
    Math.max(0, Number(hoursText) || 0) * HOUR_MS +
      Math.max(0, Number(minutesText) || 0) * MINUTE_MS,
  );
  return {
    allocationText,
    setAllocationText,
    allocationBytes: Math.max(0, Number(allocationText) || 0) * GB,
    autoPause,
    setAutoPause,
    // A countdown runs from its own start, so it is written on a cycle that does
    // not move that start under it.
    cycle: timer ? { kind: "once" } : cycleFor(kind, weekday, day, startedMs, billingDay),
    kind,
    setKind,
    billingDay,
    ceiling,
    setCeiling,
    weekday,
    setWeekday,
    dayText,
    setDayText,
    day,
    timer,
    setTimer,
    countdownMs: timer ? countdownMs : undefined,
    hoursText,
    setHoursText,
    minutesText,
    setMinutesText,
  };
}

/** What a rule measures, as three things to choose between rather than an
 *  allowance with extras bolted on. Each shows only its own fields. */
export type RuleMode = "limit" | "timer" | "schedule";

/** What auto-pause does as it is currently set. */
export function autoPauseDetail(on: boolean, mode: RuleMode, several: boolean): string {
  if (!on) return "Watches and announces, but never cuts anything off.";
  const whose = several ? "their internet" : "this device’s internet";
  if (mode === "timer") return `Cuts ${whose} when the time is up.`;
  if (mode === "schedule") return `Cuts ${whose} outside the hours set below.`;
  return `Cuts ${whose} until the cycle turns over.`;
}

export interface RuleModeDraft {
  mode: RuleMode;
  chooseMode: (next: RuleMode) => void;
  /** Only a schedule offers an allowance beside it, and it opens off: those
   *  hours are usually unrestricted, and a cap is the exception someone adds. */
  capping: boolean;
  setCapping: (next: boolean) => void;
  /** A schedule's allowance is opt-in; a plain limit always carries one. */
  capBytes: number;
  /** Whether the rule divides an allowance at all. */
  carriesAllowance: boolean;
  /** Whether the rule as set would hold anything at all — a rule has to
   *  measure something, and a timetable counts the same as a byte figure. */
  measuresSomething: boolean;
}

/** Which of the three things a rule measures, and what switching between them
 *  changes. Shared by both forms so either save reads the mode the same way. */
export function useRuleModeDraft(
  stored: { countdownMs?: number; schedule?: Schedule; allocationBytes?: number } | undefined,
  allowance: AllowanceDraft,
  timetable: ScheduleDraft,
): RuleModeDraft {
  const [mode, setMode] = useState<RuleMode>(
    stored?.countdownMs !== undefined
      ? "timer"
      : stored?.schedule && stored.schedule.windows.length > 0
        ? "schedule"
        : "limit",
  );
  const [capping, setCapping] = useState(mode === "schedule" && (stored?.allocationBytes ?? 0) > 0);
  const chooseMode = (next: RuleMode) => {
    setMode(next);
    // The draft writes a countdown on a cycle that does not roll, so its own flag
    // has to follow the mode rather than be read back from it.
    allowance.setTimer(next === "timer");
    // A schedule with no window is a mode that looks like it did nothing, so the
    // first one is opened rather than asked for.
    if (next === "schedule" && timetable.windows.length === 0) timetable.addWindow();
  };
  const capBytes =
    mode === "schedule" ? (capping ? allowance.allocationBytes : 0) : allowance.allocationBytes;
  const carriesAllowance = mode === "limit" || (mode === "schedule" && capping);
  const measuresSomething =
    mode === "timer"
      ? (allowance.countdownMs ?? 0) > 0
      : mode === "schedule"
        ? timetable.schedule !== null
        : capBytes > 0;
  return { mode, chooseMode, capping, setCapping, capBytes, carriesAllowance, measuresSomething };
}

/** The rule as it is written down. Measures the mode does not use are dropped,
 *  so a rule is never enforced on hours the form no longer shows. */
export function ruleTerms(
  rules: RuleModeDraft,
  allowance: AllowanceDraft,
  timetable: ScheduleDraft,
): {
  allocationBytes: number;
  autoPause: boolean;
  cycle: MeterCycle;
  countdownMs?: number;
  schedule?: Schedule;
} {
  return {
    // A rule keeping only a schedule carries no allowance, and the recorder
    // reads nothing as no cap rather than a cap of nothing.
    allocationBytes: rules.mode === "timer" ? 0 : rules.capBytes,
    autoPause: allowance.autoPause,
    cycle: allowance.cycle,
    ...(rules.mode === "timer" && allowance.countdownMs !== undefined
      ? { countdownMs: allowance.countdownMs }
      : {}),
    ...(rules.mode === "schedule" && timetable.schedule ? { schedule: timetable.schedule } : {}),
  };
}
