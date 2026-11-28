// Pure terms for a quick scheduled pause — the day presets, the validation the
// form applies before writing, and the check that stops a second identical
// schedule being created beside one that already covers the same devices and
// hours.
//
// Kept out of the dialog so it can be unit-tested without a renderer, and so the
// overview and the form cannot word or compare a window two different ways.

import { formatScheduleParam, type Schedule, type ScheduleWindow } from "@core/schedule";
import type { DeviceGroup } from "@core/deviceGroup";

/** Local weekdays as `Date.getDay` reports them, Sunday first. */
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];

export type DayPreset = "everyDay" | "weekdays" | "weekend" | "custom";

export type ScheduleError = "noDays" | "sameTime";

export interface ScheduleTerms {
  days: number[];
  startMinute: number;
  endMinute: number;
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Which preset a day selection corresponds to, for highlighting the chips. */
export function dayPreset(days: readonly number[]): DayPreset {
  if (sameDays(days, EVERY_DAY)) return "everyDay";
  if (sameDays(days, WEEKDAYS)) return "weekdays";
  if (sameDays(days, WEEKEND)) return "weekend";
  return "custom";
}

/**
 * What is wrong with these terms, if anything.
 *
 * A window whose start equals its end is a whole day as `core/schedule` reads
 * it, but in a nightly-pause form that is almost always a slip — someone
 * meaning 10pm to 7am and leaving both pickers on the same hour. Refusing it
 * here is cheaper than a device that never comes back online.
 */
export function validateSchedule(terms: ScheduleTerms): ScheduleError | null {
  if (terms.days.length === 0) return "noDays";
  if (terms.startMinute === terms.endMinute) return "sameTime";
  return null;
}

/** The schedule these terms describe: one block window over the chosen days. */
export function scheduledPause(terms: ScheduleTerms): Schedule {
  return {
    mode: "block",
    windows: [
      {
        weekdays: [...terms.days].sort(),
        startMinute: terms.startMinute,
        endMinute: terms.endMinute,
      },
    ],
  };
}

/** A day set and hour pair written the way the recorder stores it, so two
 *  schedules that mean the same thing compare equal. */
function scheduleSignature(schedule: Schedule): string {
  return formatScheduleParam({
    mode: schedule.mode,
    windows: schedule.windows.map((window: ScheduleWindow) => ({
      weekdays: [...window.weekdays].sort(),
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      // A quick schedule never carries dates; dropping them keeps a stored
      // window that does carry them from comparing unequal for no reason.
      fromDate: undefined,
      toDate: undefined,
    })),
  });
}

function memberSignature(keys: readonly string[]): string {
  return [...keys].sort().join(",");
}

/**
 * A group already covering exactly these devices on exactly these hours, if one
 * exists. The dialog updates that group rather than creating a twin — two rules
 * with the same terms would each pause the same devices, and deleting one would
 * look like it had failed to release them.
 */
export function findMatchingGroup(
  groups: readonly DeviceGroup[],
  terms: ScheduleTerms,
  memberKeys: readonly string[],
): DeviceGroup | undefined {
  const wantedSchedule = scheduleSignature(scheduledPause(terms));
  const wantedMembers = memberSignature(memberKeys);
  return groups.find(
    (group) =>
      group.schedule !== undefined &&
      group.schedule.mode === "block" &&
      scheduleSignature(group.schedule) === wantedSchedule &&
      memberSignature(group.memberKeys) === wantedMembers,
  );
}
