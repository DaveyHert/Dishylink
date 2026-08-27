// What is asserted here is the pair of answers the recorder acts on: whether the
// timetable holds a device shut now, and when that stops being true. The second
// drives both edges of the pause, so a segment ending at the wrong instant is a
// device left offline past its bedtime or let back on early.
//
// Boundaries are asserted by their wall-clock hour rather than by arithmetic on
// milliseconds, which is what makes these pass in any timezone — and the same
// property that keeps a 4pm window at 4pm across a daylight saving shift.

import { describe, expect, it } from "vitest";
import {
  blockedAt,
  formatScheduleParam,
  parseScheduleParam,
  scheduleActive,
  scheduleGoverns,
  scheduleSegment,
  type Schedule,
} from "./schedule";

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute).getTime();

/** The arrangement this was built for: weekday evenings and longer weekends,
 *  one timetable over one set of devices. */
const kids: Schedule = {
  mode: "allow",
  windows: [
    { weekdays: WEEKDAYS, startMinute: 16 * 60, endMinute: 20 * 60 },
    { weekdays: WEEKEND, startMinute: 9 * 60, endMinute: 21 * 60 },
  ],
};

describe("a timetable's current state", () => {
  it("opens the device inside an allow window", () => {
    expect(blockedAt(kids, at(17, 18))).toBe(false);
  });

  it("holds it shut before the window opens on a day the timetable covers", () => {
    expect(blockedAt(kids, at(17, 10))).toBe(true);
  });

  it("holds it shut again once the window has closed", () => {
    expect(blockedAt(kids, at(17, 21))).toBe(true);
  });

  it("reads the weekend off its own window rather than the weekday one", () => {
    expect(blockedAt(kids, at(22, 10))).toBe(false);
    expect(blockedAt(kids, at(22, 22))).toBe(true);
  });

  it("leaves a day the timetable never mentions unrestricted", () => {
    // Nothing has been said about Saturday, and reading silence as "blocked"
    // would cut a device off on the strength of a rule that never mentions it.
    const weekdaysOnly: Schedule = {
      mode: "allow",
      windows: [{ weekdays: WEEKDAYS, startMinute: 16 * 60, endMinute: 20 * 60 }],
    };
    expect(blockedAt(weekdaysOnly, at(22, 3))).toBe(false);
    expect(blockedAt(weekdaysOnly, at(22, 12))).toBe(false);
  });

  it("shuts the device inside a block window and leaves it open outside", () => {
    const bedtime: Schedule = {
      mode: "block",
      windows: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 22 * 60, endMinute: 7 * 60 }],
    };
    expect(blockedAt(bedtime, at(17, 23))).toBe(true);
    expect(blockedAt(bedtime, at(18, 3))).toBe(true);
    expect(blockedAt(bedtime, at(18, 9))).toBe(false);
  });

  it("finishes a window that runs past midnight on the day it opened", () => {
    // Listed on Monday only, so Tuesday at 1am is still inside Monday's window.
    const lateMonday: Schedule = {
      mode: "block",
      windows: [{ weekdays: [1], startMinute: 22 * 60, endMinute: 2 * 60 }],
    };
    expect(blockedAt(lateMonday, at(18, 1))).toBe(true);
    expect(blockedAt(lateMonday, at(18, 3))).toBe(false);
  });

  it("runs a one-off on its own date and no other", () => {
    const examDay: Schedule = {
      mode: "block",
      windows: [
        {
          weekdays: [],
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          fromDate: "2026-08-19",
          toDate: "2026-08-19",
        },
      ],
    };
    expect(blockedAt(examDay, at(19, 12))).toBe(true);
    expect(blockedAt(examDay, at(26, 12))).toBe(false);
  });

  it("runs a dated window every day between its ends and none outside them", () => {
    const holidays: Schedule = {
      mode: "block",
      windows: [
        {
          weekdays: [],
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          fromDate: "2026-08-17",
          toDate: "2026-08-21",
        },
      ],
    };
    // Both ends are inside it, and a weekend day between them is too.
    expect(blockedAt(holidays, at(17, 12))).toBe(true);
    expect(blockedAt(holidays, at(21, 12))).toBe(true);
    expect(blockedAt(holidays, at(16, 12))).toBe(false);
    expect(blockedAt(holidays, at(22, 12))).toBe(false);
  });

  it("narrows a dated window to the weekdays it names", () => {
    const termTime: Schedule = {
      mode: "allow",
      windows: [
        {
          weekdays: WEEKDAYS,
          startMinute: 16 * 60,
          endMinute: 20 * 60,
          fromDate: "2026-08-17",
          toDate: "2026-08-31",
        },
      ],
    };
    // Inside the run and on a listed weekday: shut until the window opens.
    expect(blockedAt(termTime, at(17, 10))).toBe(true);
    // Inside the run but a Saturday, which the window does not name.
    expect(blockedAt(termTime, at(22, 10))).toBe(false);
    // A Monday after the run has ended.
    expect(blockedAt(termTime, at(31 + 7, 10))).toBe(false);
  });

  it("says nothing at all before a run of dates begins", () => {
    const january: Schedule = {
      mode: "allow",
      windows: [
        {
          weekdays: [],
          startMinute: 16 * 60,
          endMinute: 20 * 60,
          fromDate: "2027-01-01",
          toDate: "2027-02-14",
        },
      ],
    };
    expect(blockedAt(january, at(17, 10))).toBe(false);
    expect(Number.isFinite(scheduleSegment(january, at(17, 10)).endMs)).toBe(true);
  });
});

// `blockedAt` returning false covers two different situations, and a card that
// cannot tell them apart calls a rule sitting out the weekend "Active".
describe("whether the timetable has any bearing at all", () => {
  const weekdaysOnly: Schedule = {
    mode: "allow",
    windows: [{ weekdays: WEEKDAYS, startMinute: 16 * 60, endMinute: 20 * 60 }],
  };

  it("sits out a day it never mentions", () => {
    expect(scheduleGoverns(weekdaysOnly, at(22, 12))).toBe(false);
  });

  it("governs a day it covers, inside its window and outside it", () => {
    expect(scheduleGoverns(weekdaysOnly, at(21, 18))).toBe(true);
    expect(scheduleGoverns(weekdaysOnly, at(21, 10))).toBe(true);
  });

  it("goes on governing past midnight while a window it opened is still running", () => {
    const overnight: Schedule = {
      mode: "allow",
      windows: [{ weekdays: [5], startMinute: 21 * 60, endMinute: 2 * 60 }],
    };
    expect(scheduleGoverns(overnight, at(22, 1))).toBe(true);
    expect(scheduleGoverns(overnight, at(22, 3))).toBe(false);
  });
});

describe("when the timetable's answer next changes", () => {
  it("ends the shut stretch at the minute the window opens", () => {
    const segment = scheduleSegment(kids, at(17, 10));
    expect(segment.blocked).toBe(true);
    expect(new Date(segment.endMs).getHours()).toBe(16);
    expect(new Date(segment.endMs).getDate()).toBe(17);
  });

  it("ends the open stretch at the minute the window closes", () => {
    const segment = scheduleSegment(kids, at(17, 18));
    expect(segment.blocked).toBe(false);
    expect(new Date(segment.endMs).getHours()).toBe(20);
  });

  it("carries a shut stretch across midnight to the next day's opening", () => {
    // The boundary is Saturday's opening, not the midnight between.
    const segment = scheduleSegment(kids, at(21, 21));
    expect(segment.blocked).toBe(true);
    expect(new Date(segment.endMs).getDate()).toBe(22);
    expect(new Date(segment.endMs).getHours()).toBe(9);
  });

  it("treats midnight as a boundary when the day after is one nothing covers", () => {
    // Released at midnight, because Saturday is a day nothing covers.
    const weekdaysOnly: Schedule = {
      mode: "allow",
      windows: [{ weekdays: WEEKDAYS, startMinute: 16 * 60, endMinute: 20 * 60 }],
    };
    const segment = scheduleSegment(weekdaysOnly, at(21, 21));
    expect(segment.blocked).toBe(true);
    expect(new Date(segment.endMs).getDate()).toBe(22);
    expect(new Date(segment.endMs).getHours()).toBe(0);
  });

  it("hands back a finite end when nothing ahead of it changes", () => {
    // Infinity would reach the rule store as JSON null, read back as zero, and
    // roll the segment on every poll.
    const spent: Schedule = {
      mode: "block",
      windows: [
        {
          weekdays: [],
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          fromDate: "2026-08-01",
          toDate: "2026-08-01",
        },
      ],
    };
    const segment = scheduleSegment(spent, at(19, 12));
    expect(segment.blocked).toBe(false);
    expect(Number.isFinite(segment.endMs)).toBe(true);
    expect(segment.endMs).toBe(at(20, 12));
  });

  it("reads overlapping windows as one stretch rather than two", () => {
    const overlapping: Schedule = {
      mode: "allow",
      windows: [
        { weekdays: [1], startMinute: 9 * 60, endMinute: 18 * 60 },
        { weekdays: [1], startMinute: 12 * 60, endMinute: 14 * 60 },
      ],
    };
    const segment = scheduleSegment(overlapping, at(17, 13));
    expect(segment.blocked).toBe(false);
    expect(new Date(segment.endMs).getHours()).toBe(18);
  });

  it("keeps a boundary on its wall clock rather than a fixed span from now", () => {
    // 4pm on the clock in the room, whatever that day's length is.
    for (const day of [17, 18, 19, 20, 21]) {
      const segment = scheduleSegment(kids, at(day, 6));
      expect(new Date(segment.endMs).getHours()).toBe(16);
      expect(new Date(segment.endMs).getMinutes()).toBe(0);
    }
  });
});

describe("a timetable on the wire", () => {
  it("survives the round trip through a query parameter", () => {
    expect(formatScheduleParam(kids)).toBe("allow;12345@960-1200;06@540-1260");
    expect(parseScheduleParam(formatScheduleParam(kids))).toEqual(kids);
  });

  it("carries a one-off as a run of dates with both ends on it", () => {
    const examDay: Schedule = {
      mode: "block",
      windows: [
        {
          weekdays: [],
          startMinute: 540,
          endMinute: 1020,
          fromDate: "2026-08-19",
          toDate: "2026-08-19",
        },
      ],
    };
    expect(formatScheduleParam(examDay)).toBe("block;~2026-08-19..2026-08-19@540-1020");
    expect(parseScheduleParam(formatScheduleParam(examDay))).toEqual(examDay);
  });

  it("carries weekdays confined to a run of dates", () => {
    const termTime: Schedule = {
      mode: "allow",
      windows: [
        {
          weekdays: [1, 2, 3, 4, 5],
          startMinute: 960,
          endMinute: 1200,
          fromDate: "2027-01-01",
          toDate: "2027-02-14",
        },
      ],
    };
    expect(formatScheduleParam(termTime)).toBe("allow;12345~2027-01-01..2027-02-14@960-1200");
    expect(parseScheduleParam(formatScheduleParam(termTime))).toEqual(termTime);
  });

  it("leaves a rule unscheduled rather than shut on hours nobody set", () => {
    for (const malformed of [
      "",
      "allow",
      "sometimes;12345@960-1200",
      "allow;@960-1200",
      "allow;9@x",
    ])
      expect(parseScheduleParam(malformed)).toBeNull();
  });

  it("drops the windows it cannot read and keeps the ones it can", () => {
    expect(parseScheduleParam("allow;9@60-120;1@960-1200")).toEqual({
      mode: "allow",
      windows: [{ weekdays: [1], startMinute: 960, endMinute: 1200 }],
    });
  });
});

describe("a timetable with nothing in it", () => {
  it("is inert, so a rule carrying one is metered by its allowance alone", () => {
    expect(scheduleActive(undefined)).toBe(false);
    expect(scheduleActive({ mode: "allow", windows: [] })).toBe(false);
    expect(blockedAt({ mode: "allow", windows: [] }, at(17, 10))).toBe(false);
  });
});
