// When a rule lets a device online, as a weekly timetable.
//
// A schedule holds several windows, because "4pm to 8pm on weekdays, 9am to 9pm
// at the weekend" is one arrangement over one set of devices. As two rules it
// would be the same membership kept in two places, drifting the first time a
// device joined only one of them.
//
// Everything here is local time, and every boundary is built from local date
// parts rather than by adding milliseconds — which is what keeps a window set
// for 4pm at 4pm across a daylight saving shift.

const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

/** Long enough that a window recurring weekly is always found, and a one-off
 *  date already past never is. */
const HORIZON_DAYS = 8;

export interface ScheduleWindow {
  /** Local weekdays, 0-6 from Sunday as Date.getDay reports it. */
  weekdays: number[];
  /** Minutes from local midnight. */
  startMinute: number;
  /** Minutes from local midnight. At or before `startMinute` runs past midnight
   *  into the next day, so a Monday-only 22:00-02:00 window does not need
   *  Tuesday listed to finish. */
  endMinute: number;
  /** Local dates (YYYY-MM-DD) this window is confined to, inclusive at both
   *  ends; a one-off is both on the same day. Empty `weekdays` runs every day
   *  between them, otherwise only those weekdays within them. */
  fromDate?: string;
  toDate?: string;
}

export interface Schedule {
  /**
   * `allow` opens the device inside its windows and holds it shut for the rest
   * of the days the timetable covers; `block` is the reverse.
   *
   * Both, because "online 4pm to 8pm" and "offline 10pm to 7am" are each the
   * natural way to say a different thing, and making someone express one as the
   * complement of the other is how a schedule ends up set wrong.
   */
  mode: "allow" | "block";
  windows: ScheduleWindow[];
}

function localDayStart(atMs: number, dayOffset: number): number {
  const at = new Date(atMs);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + dayOffset).getTime();
}

/** Through the Date constructor so the day's own offset applies: on the two days
 *  a year that are not 24 hours long, minute 960 is still 4pm. */
function minuteOfDay(dayStartMs: number, minute: number): number {
  const day = new Date(dayStartMs);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute).getTime();
}

function localDateKey(dayStartMs: number): string {
  const day = new Date(dayStartMs);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Counted from the midnight the window opened on, so 22:00 to 02:00 is four
 *  hours rather than a negative twenty, and 9am to 9am is the whole day. */
function spanEndMinute(window: ScheduleWindow): number {
  return window.endMinute > window.startMinute
    ? window.endMinute
    : window.endMinute + MINUTES_PER_DAY;
}

function windowRunsOn(window: ScheduleWindow, dayStartMs: number): boolean {
  const dated = window.fromDate !== undefined || window.toDate !== undefined;
  if (dated) {
    // ISO dates sort as strings, so the run is compared without parsing either end.
    const key = localDateKey(dayStartMs);
    if (window.fromDate !== undefined && key < window.fromDate) return false;
    if (window.toDate !== undefined && key > window.toDate) return false;
  }
  if (window.weekdays.length === 0) return dated;
  return window.weekdays.includes(new Date(dayStartMs).getDay());
}

/** Yesterday too: a window that crosses midnight is still the previous day's. */
function windowContains(window: ScheduleWindow, atMs: number): boolean {
  for (const dayOffset of [0, -1]) {
    const dayStartMs = localDayStart(atMs, dayOffset);
    if (!windowRunsOn(window, dayStartMs)) continue;
    const startMs = minuteOfDay(dayStartMs, window.startMinute);
    const endMs = minuteOfDay(dayStartMs, spanEndMinute(window));
    if (atMs >= startMs && atMs < endMs) return true;
  }
  return false;
}

function dayIsScheduled(schedule: Schedule, atMs: number): boolean {
  const dayStartMs = localDayStart(atMs, 0);
  return schedule.windows.some((window) => windowRunsOn(window, dayStartMs));
}

/**
 * Whether the timetable has any bearing at this instant.
 *
 * False on a day it never names, where the rule neither allows nor blocks and is
 * simply sitting the day out. Distinct from `blockedAt` returning false, which
 * also covers being inside a window that is letting traffic through.
 */
export function scheduleGoverns(schedule: Schedule, atMs: number): boolean {
  if (schedule.windows.some((window) => windowContains(window, atMs))) return true;
  return dayIsScheduled(schedule, atMs);
}

/**
 * Whether the schedule holds the device shut at this instant.
 *
 * A day the timetable does not cover is unrestricted rather than shut: a
 * timetable naming weekdays has said nothing about the weekend, and reading
 * silence as "blocked" would cut a device off on the strength of a rule that
 * never mentions it.
 *
 * Containment is answered before the day is, so a window running past midnight
 * still finishes on a day nothing else covers.
 */
export function blockedAt(schedule: Schedule, atMs: number): boolean {
  const inside = schedule.windows.some((window) => windowContains(window, atMs));
  if (schedule.mode === "block") return inside;
  return !inside && dayIsScheduled(schedule, atMs);
}

/** Both edges of every window in range, plus every local midnight — where a day
 *  the timetable covers becomes one it does not. */
function candidateBoundaries(schedule: Schedule, atMs: number): number[] {
  const found = new Set<number>();
  for (let dayOffset = -1; dayOffset <= HORIZON_DAYS; dayOffset++) {
    const dayStartMs = localDayStart(atMs, dayOffset);
    found.add(dayStartMs);
    for (const window of schedule.windows) {
      if (!windowRunsOn(window, dayStartMs)) continue;
      found.add(minuteOfDay(dayStartMs, window.startMinute));
      found.add(minuteOfDay(dayStartMs, spanEndMinute(window)));
    }
  }
  return [...found].filter((boundary) => boundary > atMs).sort((first, second) => first - second);
}

/**
 * The stretch the schedule is currently in: whether it holds the device shut,
 * and when that stops being true.
 *
 * The end is found by asking blockedAt at each instant the answer could change
 * rather than by deriving it from whichever window is nearest, so overlapping
 * windows cannot have the segment disagree with the state.
 *
 * Always finite. Infinity reaches the rule store as JSON null, reads back as
 * zero, and rolls the segment on every poll.
 */
export function scheduleSegment(
  schedule: Schedule,
  atMs: number,
): { blocked: boolean; endMs: number } {
  const blocked = blockedAt(schedule, atMs);
  for (const boundary of candidateBoundaries(schedule, atMs))
    if (blockedAt(schedule, boundary) !== blocked) return { blocked, endMs: boundary };
  return { blocked, endMs: atMs + DAY_MS };
}

/** An empty timetable is inert: the rule carrying it is metered by its allowance
 *  alone. */
export function scheduleActive(schedule: Schedule | undefined): schedule is Schedule {
  return schedule !== undefined && schedule.windows.length > 0;
}

/**
 * A timetable as one query parameter, since every rule write on both hosts is a
 * URL: `allow;12345@960-1200;06@540-1260`, with a run of dates appended to the
 * weekdays as `~2026-01-01..2026-02-14`.
 */
export function formatScheduleParam(schedule: Schedule): string {
  const windows = schedule.windows.map((window) => {
    const weekdays = [...window.weekdays].sort().join("");
    const run =
      window.fromDate === undefined && window.toDate === undefined
        ? ""
        : `~${window.fromDate ?? ""}..${window.toDate ?? ""}`;
    return `${weekdays}${run}@${window.startMinute}-${window.endMinute}`;
  });
  return [schedule.mode, ...windows].join(";");
}

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

const dateOrNothing = (value: string | undefined) =>
  value !== undefined && DATE_PARAM.test(value) ? { value } : undefined;

function windowFromParam(value: string): ScheduleWindow | null {
  const [days, span] = value.split("@");
  const [start, end] = (span ?? "").split("-");
  const startMinute = Number(start);
  const endMinute = Number(end);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null;
  const [weekdayPart, runPart] = (days ?? "").split("~");
  const [from, to] = (runPart ?? "").split("..");
  const fromDate = dateOrNothing(from);
  const toDate = dateOrNothing(to);
  const weekdays = [...new Set([...weekdayPart].map(Number))].filter(
    (weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6,
  );
  // A window naming neither weekdays nor a run of dates falls on no day at all.
  if (weekdays.length === 0 && !fromDate && !toDate) return null;
  return {
    weekdays,
    startMinute: Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(startMinute))),
    endMinute: Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(endMinute))),
    ...(fromDate ? { fromDate: fromDate.value } : {}),
    ...(toDate ? { toDate: toDate.value } : {}),
  };
}

/** Null when the parameter names no usable window, so a malformed timetable
 *  leaves a rule unscheduled rather than shut on hours nobody set. */
export function parseScheduleParam(value: string | null): Schedule | null {
  if (!value) return null;
  const [mode, ...rest] = value.split(";");
  if (mode !== "allow" && mode !== "block") return null;
  const windows = rest.flatMap((entry) => windowFromParam(entry) ?? []);
  return windows.length === 0 ? null : { mode, windows };
}
