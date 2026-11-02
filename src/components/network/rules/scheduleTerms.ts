// How a timetable reads on screen, and the draft someone edits before it is
// saved. Every string turning stored minutes into words is here, so a card and
// the form that wrote it cannot word the same window two ways.

import { useState } from "react";
import type { TFunction } from "i18next";
import type { Schedule, ScheduleWindow } from "@core/schedule";
import { weekdayNames } from "./allowanceTerms";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

export const MINUTES_PER_DAY = 1440;

/** "4:00 PM", in the user's locale. Midnight at the end of a window reads as
 *  the end of the day it closes rather than the start of the one it does not
 *  reach. */
export function clockLabel(minutes: number, t: TFunction, locale: string): string {
  if (minutes >= MINUTES_PER_DAY) return t("rules.midnight");
  return new Date(2024, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const sameDays = (days: readonly number[], other: readonly number[]) =>
  days.length === other.length && [...days].sort().join() === [...other].sort().join();

/** "2026-08-19" as "Wed 19 Aug". */
export function dateLabel(dateKey: string, locale: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

/** The run of dates a window is confined to, if any: one date when both ends
 *  land on it, "19 Aug – 14 Sep" otherwise. */
export function runLabel(window: ScheduleWindow, t: TFunction, locale: string): string | null {
  const { fromDate, toDate } = window;
  if (!fromDate && !toDate) return null;
  if (fromDate && fromDate === toDate) return dateLabel(fromDate, locale);
  if (!toDate) return t("rules.fromDate", { date: dateLabel(fromDate!, locale) });
  if (!fromDate) return t("rules.untilDate", { date: dateLabel(toDate, locale) });
  return `${dateLabel(fromDate, locale)} – ${dateLabel(toDate, locale)}`;
}

function weekdaysLabel(weekdays: readonly number[], t: TFunction, locale: string): string {
  if (sameDays(weekdays, EVERY_DAY)) return t("rules.everyDay");
  if (sameDays(weekdays, WEEKDAYS)) return t("rules.weekdaysShort");
  if (sameDays(weekdays, WEEKEND)) return t("rules.weekendShort");
  const names = weekdayNames(locale, "short");
  return [...weekdays]
    .sort()
    .map((weekday) => names[weekday])
    .join(", ");
}

export function daysLabel(window: ScheduleWindow, t: TFunction, locale: string): string {
  const run = runLabel(window, t, locale);
  if (window.weekdays.length === 0) return run ?? t("rules.noDays");
  const days = weekdaysLabel(window.weekdays, t, locale);
  return run ? `${days}, ${run}` : days;
}

export type Repeat = "weekly" | "once" | "range";

/** Held rather than derived from the dates: a half-picked range and a one-off
 *  are the same two dates, so deriving it takes the second click away. */
export interface WindowDraft extends ScheduleWindow {
  repeat: Repeat;
}

/** A window a rule opens with: weekday daytime hours, the arrangement most
 *  people reach for first. */
export function openingWindow(): WindowDraft {
  return { repeat: "weekly", weekdays: [...WEEKDAYS], startMinute: 8 * 60, endMinute: 18 * 60 };
}

/** What switching a window to each shape leaves it holding. A range opens on two
 *  different days so it has something to show before either end is picked. */
export function repeatTerms(repeat: Repeat): Partial<WindowDraft> {
  if (repeat === "weekly")
    return { repeat, fromDate: undefined, toDate: undefined, weekdays: [1, 2, 3, 4, 5] };
  if (repeat === "once") return { repeat, fromDate: todayKey(), toDate: todayKey(), weekdays: [] };
  return { repeat, fromDate: todayKey(), toDate: todayKey(7), weekdays: [] };
}

/** Built from local parts, not toISOString, which is already tomorrow for an
 *  evening east of Greenwich and still yesterday for a morning west of it. */
export function todayKey(dayOffset = 0): string {
  const day = new Date();
  day.setDate(day.getDate() + dayOffset);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, "0")}`;
}

/** Only for a window read back from the recorder, which stores dates and no
 *  shape. A range saved with both ends on one day was a one-off. */
function storedRepeat(window: ScheduleWindow): Repeat {
  if (window.fromDate === undefined) return "weekly";
  return window.toDate === window.fromDate ? "once" : "range";
}

export interface ScheduleDraft {
  mode: Schedule["mode"];
  setMode: (mode: Schedule["mode"]) => void;
  windows: WindowDraft[];
  addWindow: () => void;
  removeWindow: (index: number) => void;
  updateWindow: (index: number, changes: Partial<WindowDraft>) => void;
  toggleWeekday: (index: number, weekday: number) => void;
  /** Null when no window would hold, which is how a rule is left unscheduled. */
  schedule: Schedule | null;
}

export function useScheduleDraft(stored: Schedule | undefined): ScheduleDraft {
  const [mode, setMode] = useState<Schedule["mode"]>(stored?.mode ?? "allow");
  const [windows, setWindows] = useState<WindowDraft[]>(() =>
    (stored?.windows ?? []).map((window) => ({ ...window, repeat: storedRepeat(window) })),
  );

  const updateWindow = (index: number, changes: Partial<WindowDraft>) =>
    setWindows((held) =>
      held.map((window, at) => (at === index ? { ...window, ...changes } : window)),
    );

  // A range with only one end picked is not written: it names no run of days yet.
  const kept = windows.filter((window) =>
    window.repeat === "weekly" ? window.weekdays.length > 0 : window.toDate !== undefined,
  );

  return {
    mode,
    setMode,
    windows,
    addWindow: () => setWindows((held) => [...held, openingWindow()]),
    removeWindow: (index) => setWindows((held) => held.filter((_, at) => at !== index)),
    updateWindow,
    toggleWeekday: (index, weekday) =>
      setWindows((held) =>
        held.map((window, at) => {
          if (at !== index) return window;
          const weekdays = window.weekdays.includes(weekday)
            ? window.weekdays.filter((other) => other !== weekday)
            : [...window.weekdays, weekday];
          return { ...window, weekdays: weekdays.sort() };
        }),
      ),
    schedule:
      kept.length === 0
        ? null
        : { mode, windows: kept.map(({ repeat: _shape, ...window }) => window) },
  };
}
