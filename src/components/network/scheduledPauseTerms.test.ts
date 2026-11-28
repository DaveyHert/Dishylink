// The terms a quick scheduled pause is judged by: the preset a day set maps to,
// what makes a form unsavable, and whether an existing schedule already says the
// same thing — which is what keeps a second identical rule from being created
// beside the first.

import { describe, expect, it } from "vitest";
import type { DeviceGroup } from "@core/deviceGroup";
import {
  EVERY_DAY,
  WEEKDAYS,
  WEEKEND,
  dayPreset,
  findMatchingGroup,
  scheduledPause,
  validateSchedule,
} from "./scheduledPauseTerms";

const NIGHT = { startMinute: 22 * 60, endMinute: 7 * 60 };

const group = (overrides: Partial<DeviceGroup> = {}): DeviceGroup => ({
  groupId: "nightly",
  name: "Nightly pause",
  memberKeys: ["7", "8"],
  allocationBytes: 0,
  autoPause: true,
  cycle: { kind: "daily" },
  mode: "perMember",
  schedule: scheduledPause({ days: EVERY_DAY, ...NIGHT }),
  updatedMs: 0,
  createdMs: 0,
  ...overrides,
});

describe("dayPreset", () => {
  it("recognises the three named arrangements", () => {
    expect(dayPreset(EVERY_DAY)).toBe("everyDay");
    expect(dayPreset(WEEKDAYS)).toBe("weekdays");
    expect(dayPreset(WEEKEND)).toBe("weekend");
  });

  it("calls anything else custom, whatever order the days are in", () => {
    expect(dayPreset([1, 2, 3])).toBe("custom");
    expect(dayPreset([5, 1, 3, 2, 4])).toBe("weekdays");
  });
});

describe("validateSchedule", () => {
  it("refuses a timetable with no days", () => {
    expect(validateSchedule({ days: [], ...NIGHT })).toBe("noDays");
  });

  it("refuses a start and end on the same minute", () => {
    expect(validateSchedule({ days: EVERY_DAY, startMinute: 600, endMinute: 600 })).toBe(
      "sameTime",
    );
  });

  it("accepts an overnight window", () => {
    expect(validateSchedule({ days: EVERY_DAY, ...NIGHT })).toBeNull();
  });

  it("accepts a daytime window", () => {
    expect(
      validateSchedule({ days: WEEKDAYS, startMinute: 8 * 60, endMinute: 18 * 60 }),
    ).toBeNull();
  });
});

describe("scheduledPause", () => {
  it("writes one block window over the days, sorted as the store keeps them", () => {
    expect(scheduledPause({ days: [5, 1, 3], ...NIGHT })).toEqual({
      mode: "block",
      windows: [{ weekdays: [1, 3, 5], startMinute: 22 * 60, endMinute: 7 * 60 }],
    });
  });
});

describe("findMatchingGroup", () => {
  it("given: the same devices on the same hours, should: find that group", () => {
    const groups = [group()];
    expect(findMatchingGroup(groups, { days: EVERY_DAY, ...NIGHT }, ["8", "7"])?.groupId).toBe(
      "nightly",
    );
  });

  it("given: different hours, should: find nothing", () => {
    const groups = [group()];
    expect(
      findMatchingGroup(groups, { days: EVERY_DAY, startMinute: 20 * 60, endMinute: 7 * 60 }, [
        "7",
        "8",
      ]),
    ).toBeUndefined();
  });

  it("given: a different set of devices, should: find nothing", () => {
    const groups = [group()];
    expect(findMatchingGroup(groups, { days: EVERY_DAY, ...NIGHT }, ["7"])).toBeUndefined();
  });

  it("given: the same hours on a different day set, should: find nothing", () => {
    const groups = [group()];
    expect(findMatchingGroup(groups, { days: WEEKEND, ...NIGHT }, ["7", "8"])).toBeUndefined();
  });

  it("given: a group that allows rather than blocks, should: find nothing", () => {
    const allow = group({
      groupId: "allowed",
      schedule: {
        mode: "allow",
        windows: [{ weekdays: [...EVERY_DAY], startMinute: 22 * 60, endMinute: 7 * 60 }],
      },
    });
    expect(findMatchingGroup([allow], { days: EVERY_DAY, ...NIGHT }, ["7", "8"])).toBeUndefined();
  });

  it("given: a stored window that also names dates, should: still match on days and hours", () => {
    const dated = group({
      schedule: {
        mode: "block",
        windows: [
          {
            weekdays: [...EVERY_DAY],
            startMinute: 22 * 60,
            endMinute: 7 * 60,
            fromDate: "2026-01-01",
            toDate: "2026-02-01",
          },
        ],
      },
    });
    expect(findMatchingGroup([dated], { days: EVERY_DAY, ...NIGHT }, ["7", "8"])?.groupId).toBe(
      "nightly",
    );
  });

  it("given: a group with no timetable at all, should: find nothing", () => {
    const allowance = group({ groupId: "cap", schedule: undefined });
    expect(
      findMatchingGroup([allowance], { days: EVERY_DAY, ...NIGHT }, ["7", "8"]),
    ).toBeUndefined();
  });
});
