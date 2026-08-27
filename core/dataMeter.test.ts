// What is asserted here is the arithmetic a data allowance rests on: where each
// cycle kind puts its boundaries, that usage is measured from the rule's own
// anchor rather than from whatever the odometer's month happens to hold, that a
// trip fires once per cycle and not once per poll, and that a cycle rolls — and
// releases the pause it applied — for a device that is not there to be polled.

import { describe, expect, it } from "vitest";
import {
  countdownLeftMs,
  listChanged,
  createRule,
  evaluateMeters,
  MAX_COUNTDOWN_MS,
  periodBounds,
  restartCycle,
  restoredRule,
  ruleHoldsDevice,
  upsertRule,
  usageBytes,
  type MeterCycle,
  type MeterRule,
} from "./dataMeter";

const KEY = "2806438232";
const GB = 1_000_000_000;
// A Wednesday, mid-month, mid-afternoon: far from every boundary under test.
const T0 = new Date(2026, 7, 12, 15, 30, 0).getTime();

function rule(over: Partial<MeterRule> = {}, cycle: MeterCycle = { kind: "daily" }): MeterRule {
  return {
    ...createRule({
      clientKey: KEY,
      allocationBytes: 20 * GB,
      cycle,
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    }),
    ...over,
  };
}

const read = (rx: number, tx = 0) => [{ clientKey: KEY, lifetimeRx: rx, lifetimeTx: tx }];

describe("periodBounds", () => {
  it("runs a daily cycle from local midnight", () => {
    const { startMs, endMs } = periodBounds({ kind: "daily" }, T0);
    expect(new Date(startMs).getHours()).toBe(0);
    expect(new Date(startMs).getDate()).toBe(12);
    expect(endMs - startMs).toBe(86_400_000);
  });

  it("runs a weekly cycle from the most recent chosen weekday", () => {
    // T0 is a Wednesday; a cycle rolling on Monday started two days earlier.
    const { startMs, endMs } = periodBounds({ kind: "weekly", weekday: 1 }, T0);
    expect(new Date(startMs).getDay()).toBe(1);
    expect(new Date(startMs).getDate()).toBe(10);
    expect(endMs - startMs).toBe(7 * 86_400_000);
  });

  it("holds a monthly cycle to the day it rolls on, either side of that day", () => {
    const after = periodBounds({ kind: "monthly", day: 7 }, T0); // 12th, so this month's 7th
    expect(new Date(after.startMs).getDate()).toBe(7);
    expect(new Date(after.startMs).getMonth()).toBe(7);
    expect(new Date(after.endMs).getMonth()).toBe(8);

    const beforeTheDay = new Date(2026, 7, 3, 9, 0, 0).getTime();
    const before = periodBounds({ kind: "monthly", day: 7 }, beforeTheDay);
    expect(new Date(before.startMs).getMonth()).toBe(6); // still July's cycle
    expect(new Date(before.endMs).getDate()).toBe(7);
  });

  it("lands a monthly cycle on the last day of a month too short for it", () => {
    // Rolling on the 31st, seen mid-June: the last roll was 31 May, and the next
    // falls on the 30th because June has no 31st.
    const inJune = new Date(2026, 5, 15).getTime();
    const { startMs, endMs } = periodBounds({ kind: "monthly", day: 31 }, inJune);
    expect([new Date(startMs).getMonth(), new Date(startMs).getDate()]).toEqual([4, 31]);
    expect([new Date(endMs).getMonth(), new Date(endMs).getDate()]).toEqual([5, 30]);
  });

  it("counts a custom cycle in whole spans from its own start date", () => {
    const start = new Date(2026, 7, 1).getTime();
    // T0 is the 12th: the 10-day span that began on the 11th.
    const { startMs, endMs } = periodBounds({ kind: "custom", days: 10, startMs: start }, T0);
    expect(new Date(startMs).getDate()).toBe(11);
    expect(endMs - startMs).toBe(10 * 86_400_000);
  });

  it("takes the account's cycle when there is one, and the 1st when there is not", () => {
    // The day rides on the rule, copied from the account when it was set, so the
    // period is the account's own — never a silent calendar month.
    const bounds = periodBounds({ kind: "billing", day: 6 }, T0);
    expect(new Date(bounds.startMs).getDate()).toBe(6);
    expect(new Date(bounds.endMs).getDate()).toBe(6);
  });

  it("never rolls a one-off allowance", () => {
    expect(periodBounds({ kind: "once" }, T0).endMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("evaluateMeters", () => {
  it("measures from the rule's own anchor, not from the counter's origin", () => {
    // The device had already moved 40 GB before the rule existed.
    const existing = createRule({
      clientKey: KEY,
      allocationBytes: 20 * GB,
      cycle: { kind: "daily" },
      lifetimeRx: 40 * GB,
      lifetimeTx: 0,
      nowMs: T0,
    });
    const { rules } = evaluateMeters([existing], read(45 * GB), T0 + 1_000);
    expect(usageBytes(rules[0])).toBe(5 * GB);
  });

  it("reaches the limit once, not once per poll", () => {
    let rules = [rule()];
    let all: string[] = [];
    for (const rx of [19 * GB, 21 * GB, 25 * GB, 30 * GB]) {
      const result = evaluateMeters(rules, read(rx), T0 + 1_000);
      rules = result.rules;
      all = all.concat(result.transitions.map((t) => t.kind));
    }
    expect(all).toEqual(["reached"]);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
  });

  it("trips on the allowance itself, with nothing to set separately", () => {
    const { transitions } = evaluateMeters([rule()], read(20 * GB), T0 + 1_000);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
  });

  it("counts upload against the allowance too", () => {
    const { transitions } = evaluateMeters([rule()], read(11 * GB, 10 * GB), T0 + 1_000);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
  });

  it("announces a spent allowance while auto-pause is off, with no write pending", () => {
    const watching = rule({ autoPause: false });
    const { rules, transitions } = evaluateMeters([watching], read(50 * GB), T0 + 1_000);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
    expect(usageBytes(rules[0])).toBe(50 * GB);
  });

  it("announces a spent allowance once per cycle, not on every poll", () => {
    const watching = rule({ autoPause: false });
    const first = evaluateMeters([watching], read(50 * GB), T0 + 1_000);
    const second = evaluateMeters(first.rules, read(60 * GB), T0 + 2_000);
    expect(second.transitions).toEqual([]);
  });

  it("lets go of the device when the cycle rolls, and re-anchors", () => {
    const tripped = rule({ actedThisCycle: true });
    const tomorrow = T0 + 86_400_000;
    const { rules } = evaluateMeters([tripped], read(25 * GB), tomorrow);
    expect(ruleHoldsDevice(rules[0])).toBe(false);
    expect(rules[0].actedThisCycle).toBe(false);
    expect(usageBytes(rules[0])).toBe(0);
  });

  it("rolls a cycle for a device that is offline, so it still lets go", () => {
    const tripped = rule({ actedThisCycle: true, observedRx: 25 * GB });
    // No reading at all: the device is away, its counter frozen where it stopped.
    const { rules } = evaluateMeters([tripped], [], T0 + 86_400_000);
    expect(ruleHoldsDevice(rules[0])).toBe(false);
    expect(rules[0].anchorRx).toBe(25 * GB);
    expect(usageBytes(rules[0])).toBe(0);
  });

  it("leaves a device the user unpaused by hand alone for the rest of the cycle", () => {
    let rules = [rule()];
    rules = evaluateMeters(rules, read(21 * GB), T0 + 1_000).rules;
    expect(rules[0].actedThisCycle).toBe(true);
    // The latch stays set, so the poll goes on reading the device as held and
    // nothing raises a fresh pause for it.
    const later = evaluateMeters(rules, read(40 * GB), T0 + 2_000);
    expect(later.transitions).toEqual([]);
    expect(ruleHoldsDevice(later.rules[0])).toBe(true);
  });

  it("holds a one-off allowance open past every boundary until it is restarted", () => {
    const sold = rule({}, { kind: "once" });
    const aMonthOn = T0 + 31 * 86_400_000;
    const { rules, transitions } = evaluateMeters([sold], read(5 * GB), aMonthOn);
    expect(transitions).toEqual([]);
    expect(usageBytes(rules[0])).toBe(5 * GB);

    const toppedUp = restartCycle(rules[0], aMonthOn);
    expect(usageBytes(toppedUp)).toBe(0);
    expect(toppedUp.actedThisCycle).toBe(false);
  });
});

// What is asserted here is that the three things a rule can measure stack rather
// than replace one another: each holds the device on its own, and the device is
// let go only when every one of them has.
describe("a rule measuring more than one thing", () => {
  const HOUR = 3_600_000;
  const both = (over: Partial<MeterRule> = {}) => ({
    ...createRule({
      clientKey: KEY,
      allocationBytes: 20 * GB,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 2 * HOUR,
    }),
    ...over,
  });

  it("given: an allowance and a timer, should: keep the monthly cycle rather than forcing a one-off", () => {
    // The countdown keeps its own start, so the allowance beside it goes on
    // rolling. Held on one cycle, the month would never turn over.
    const written = both();
    expect(written.cycle).toEqual({ kind: "monthly", day: 1 });
    expect(written.periodEndMs).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(countdownLeftMs(written, T0)).toBe(2 * HOUR);
  });

  it("given: the timer runs out first, should: hold the device with the allowance untouched", () => {
    const { rules, transitions } = evaluateMeters([both()], read(1 * GB), T0 + 2 * HOUR);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
    expect(rules[0].countdownActed).toBe(true);
    // The allowance has not been reached and is still counting.
    expect(rules[0].actedThisCycle).toBe(false);
    expect(usageBytes(rules[0])).toBe(1 * GB);
  });

  it("given: the allowance runs out first, should: hold the device with time still on the clock", () => {
    const { rules, transitions } = evaluateMeters([both()], read(20 * GB), T0 + HOUR);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
    expect(rules[0].actedThisCycle).toBe(true);
    expect(rules[0].countdownActed).toBe(false);
    expect(countdownLeftMs(rules[0], T0 + HOUR)).toBe(HOUR);
  });

  it("given: both run out, should: announce once rather than once per measure", () => {
    const { transitions } = evaluateMeters([both()], read(20 * GB), T0 + 2 * HOUR);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
  });

  it("given: the timer is up and the cycle rolls, should: go on holding the device", () => {
    // The month turning over is no answer to a two-hour sitting that is over.
    const spent = evaluateMeters([both()], read(20 * GB), T0 + 2 * HOUR).rules;
    const nextMonth = periodBounds({ kind: "monthly", day: 1 }, T0).endMs;
    const { rules } = evaluateMeters(spent, read(20 * GB), nextMonth);
    expect(rules[0].actedThisCycle).toBe(false);
    expect(usageBytes(rules[0])).toBe(0);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
  });

  it("given: a restart, should: start every measure over at once", () => {
    const spent = evaluateMeters([both()], read(20 * GB), T0 + 2 * HOUR).rules;
    const restarted = restartCycle(spent[0], T0 + 3 * HOUR);
    expect(ruleHoldsDevice(restarted)).toBe(false);
    expect(usageBytes(restarted)).toBe(0);
    expect(countdownLeftMs(restarted, T0 + 3 * HOUR)).toBe(2 * HOUR);
  });
});

describe("a countdown rule", () => {
  const HOUR = 3_600_000;
  const timer = (over: Partial<MeterRule> = {}) => ({
    ...createRule({
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 2 * HOUR,
    }),
    ...over,
  });

  it("given: time still on the clock, should: leave the device alone however much it spends", () => {
    const { rules, transitions } = evaluateMeters([timer()], read(900 * GB), T0 + HOUR);
    expect(transitions).toEqual([]);
    expect(ruleHoldsDevice(rules[0])).toBe(false);
  });

  it("given: the time is up, should: pause the device even having spent nothing", () => {
    const { rules, transitions } = evaluateMeters([timer()], read(0), T0 + 2 * HOUR);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
  });

  it("given: the time is up, should: reach once rather than once per poll", () => {
    let rules = [timer()];
    let kinds: string[] = [];
    for (const at of [2 * HOUR, 2 * HOUR + 1_000, 2 * HOUR + 2_000]) {
      const result = evaluateMeters(rules, read(0), T0 + at);
      rules = result.rules;
      kinds = kinds.concat(result.transitions.map((t) => t.kind));
    }
    expect(kinds.filter((kind) => kind === "reached")).toHaveLength(1);
  });

  it("given: a cycle asked for alongside a countdown, should: keep the cycle and time itself", () => {
    // The countdown measures from its own start, so it does not need the cycle
    // pinned to one that never rolls — and pinning it would stop the allowance
    // beside it from ever turning over.
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "daily" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: HOUR,
    });
    expect(written.cycle).toEqual({ kind: "daily" });
    expect(written.countdownStartMs).toBe(T0);
    expect(countdownLeftMs(written, T0)).toBe(HOUR);
  });

  it("given: a countdown past a day, should: cap it at one", () => {
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 40 * HOUR,
    });
    expect(written.countdownMs).toBe(MAX_COUNTDOWN_MS);
  });

  it("given: a countdown re-timed, should: run the new duration from now", () => {
    const spent = timer({ periodStartMs: T0 - HOUR });
    const edited = upsertRule(spent, {
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 3 * HOUR,
    });
    expect(countdownLeftMs(edited, T0)).toBe(3 * HOUR);
    expect(edited.actedThisCycle).toBe(false);
  });

  it("given: a timer that is up, should: go on holding the device", () => {
    const held = timer({ countdownStartMs: T0 - 3 * HOUR, countdownActed: true });
    expect(ruleHoldsDevice(held)).toBe(true);
  });

  it("given: a timer restarted, should: let go of the device and run its full length again", () => {
    const held = restartCycle(timer({ countdownActed: true }), T0);
    expect(ruleHoldsDevice(held)).toBe(false);
    expect(countdownLeftMs(held, T0)).toBe(2 * HOUR);
  });

  it("given: the same duration saved again, should: start the clock from now", () => {
    // The only way to say "run that again" about a timer that has already gone.
    const spent = timer({ countdownStartMs: T0 - 3 * HOUR, countdownActed: true });
    const again = upsertRule(spent, {
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 2 * HOUR,
    });
    expect(countdownLeftMs(again, T0)).toBe(2 * HOUR);
    expect(ruleHoldsDevice(again)).toBe(false);
  });
});

// What is asserted here is that a cycle which never rolls comes back from storage
// as one that never rolls. JSON cannot write Infinity, so it arrives as null,
// which every comparison reads as a boundary already past.
describe("a rule read back from storage", () => {
  const HOUR = 3_600_000;
  const stored = (input: MeterRule) => JSON.parse(JSON.stringify(input)) as MeterRule;

  it("given: a one-off cycle written to JSON, should: restore the end the format dropped", () => {
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 50 * GB,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    });
    expect(stored(written).periodEndMs).toBeNull();
    expect(restoredRule(stored(written)).periodEndMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("given: a timer restored, should: still be counting rather than already spent", () => {
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 2 * HOUR,
    });
    const { rules, transitions } = evaluateMeters(
      [restoredRule(stored(written))],
      read(GB),
      T0 + HOUR,
    );
    expect(transitions).toEqual([]);
    expect(countdownLeftMs(rules[0], T0 + HOUR)).toBe(HOUR);
  });

  it("given: a one-off allowance restored, should: keep what it had already spent", () => {
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 50 * GB,
      cycle: { kind: "once" },
      lifetimeRx: 10 * GB,
      lifetimeTx: 0,
      nowMs: T0,
    });
    const { rules } = evaluateMeters([written], read(12 * GB), T0 + 60_000);
    expect(usageBytes(rules[0])).toBe(2 * GB);
    const afterRestart = evaluateMeters(
      [restoredRule(stored(rules[0]))],
      read(12 * GB),
      T0 + 120_000,
    );
    expect(usageBytes(afterRestart.rules[0])).toBe(2 * GB);
  });

  it("given: an end that reads as past anyway, should: open the new cycle now, not at the epoch", () => {
    const written = rule({ periodEndMs: T0 - 1 }, { kind: "once" });
    const { rules } = evaluateMeters([written], read(0), T0);
    expect(rules[0].periodStartMs).toBe(T0);
  });
});

// What is asserted here is that a timetable and an allowance cannot undo each
// other: whichever is stricter holds the device, and it is released only when
// both have let go.
describe("a rule keeping a timetable", () => {
  // Weekday evenings. T0 is a Wednesday at 15:30, half an hour before it opens.
  const timetable = {
    mode: "allow" as const,
    windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 20 * 60 }],
  };
  const OPENS = new Date(2026, 7, 12, 16, 0, 0).getTime();
  const CLOSES = new Date(2026, 7, 12, 20, 0, 0).getTime();

  const timetabled = (over: Partial<MeterRule> = {}, allocationBytes = 0): MeterRule => ({
    ...createRule({
      clientKey: KEY,
      allocationBytes,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      schedule: timetable,
    }),
    ...over,
  });

  it("knows it is inside a shut stretch the moment it is written", () => {
    const written = timetabled();
    expect(written.windowBlocked).toBe(true);
    expect(written.windowEndMs).toBe(OPENS);
  });

  it("holds the device while the window is shut, without announcing it", () => {
    const { rules, transitions } = evaluateMeters([timetabled()], read(0), T0);

    expect(transitions).toEqual([]);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
    expect(rules[0].reachedAtMs).toBeUndefined();
  });

  it("announces an allowance spent while the window is shut", () => {
    // Traffic outlives a shut window whenever the pause does not land, and on a
    // watch-only rule it always does. The window says nothing itself, so it must
    // not stand in for the announcement the allowance owes — the device would be
    // held past the window opening with nothing having been said.
    const shut = timetabled({ windowActed: true }, 20 * GB);
    const { rules, transitions } = evaluateMeters([shut], read(30 * GB), T0 + 1_000);

    expect(transitions.map((transition) => transition.kind)).toEqual(["reached"]);
    expect(rules[0].actedThisCycle).toBe(true);
    expect(rules[0].reachedAtMs).toBe(T0 + 1_000);
  });

  it("latches the stretch once rather than once per poll", () => {
    const [first] = evaluateMeters([timetabled()], read(0), T0).rules;
    const again = evaluateMeters([first], read(0), T0 + 200);
    expect(again.transitions).toEqual([]);
    expect(ruleHoldsDevice(again.rules[0])).toBe(true);
  });

  it("lets go of the device when the window opens", () => {
    const shut = timetabled({ windowActed: true });
    const { rules } = evaluateMeters([shut], read(0), OPENS);

    expect(rules[0].windowBlocked).toBe(false);
    expect(ruleHoldsDevice(rules[0])).toBe(false);
    expect(rules[0].windowEndMs).toBe(CLOSES);
  });

  it("holds a device that is over its allowance through a window that opens", () => {
    const spent = timetabled({ windowActed: true, actedThisCycle: true }, 20 * GB);
    const { rules, transitions } = evaluateMeters([spent], read(30 * GB), OPENS);

    expect(transitions).toEqual([]);
    expect(ruleHoldsDevice(rules[0])).toBe(true);
  });

  it("holds a device through a cycle that rolls while the window is shut", () => {
    const rolling = timetabled(
      { windowActed: true, actedThisCycle: true, periodEndMs: T0 },
      20 * GB,
    );
    const { rules, transitions } = evaluateMeters([rolling], read(30 * GB), T0);

    expect(transitions).toEqual([]);
    expect(rules[0].actedThisCycle).toBe(false);
    // The window is still shut, so the rule goes on holding it.
    expect(ruleHoldsDevice(rules[0])).toBe(true);
  });

  it("does not spend an allowance it was never given", () => {
    const { transitions } = evaluateMeters([timetabled()], read(5 * GB), OPENS);
    expect(transitions.map((transition) => transition.kind)).not.toContain("reached");
  });

  // The reason the window keeps its own boundary instead of riding the cycle's:
  // re-anchoring here would zero the month once every evening.
  it("keeps the month's usage across a window turning over", () => {
    const both = timetabled({ windowActed: true }, 20 * GB);
    const carried = evaluateMeters([both], read(8 * GB), OPENS).rules[0];

    expect(carried.windowBlocked).toBe(false);
    expect(carried.anchorRx).toBe(0);
    expect(usageBytes(carried)).toBe(8 * GB);
    expect(carried.periodEndMs).toBe(both.periodEndMs);
  });

  it("works the new hours out from now when the timetable is edited", () => {
    const moved = upsertRule(timetabled(), {
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      schedule: {
        mode: "allow",
        windows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 21 * 60 }],
      },
    });

    // 15:30 is inside the new hours, so the rule stops holding the device.
    expect(moved.windowBlocked).toBe(false);
    expect(moved.windowEndMs).toBe(new Date(2026, 7, 12, 21, 0, 0).getTime());
  });

  it("is not let past by starting the allowance over", () => {
    const shut = timetabled({ windowActed: true }, 20 * GB);
    const restarted = restartCycle(shut, T0);
    expect(restarted.windowBlocked).toBe(true);
    expect(ruleHoldsDevice(restarted)).toBe(true);
  });
});

describe("listChanged", () => {
  it("given: a list that lost its only entry, should: report the change", () => {
    // The shape every store's reconciliation rests on. Comparing index by index
    // reads an emptied list as unchanged, so the drop is never written down.
    expect(listChanged([], ["a"])).toBe(true);
  });

  it("given: a list that lost its tail, should: report the change", () => {
    expect(listChanged(["a"], ["a", "b"])).toBe(true);
  });

  it("given: the same entries, should: report no change", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    expect(listChanged([a, b], [a, b])).toBe(false);
  });

  it("given: an entry replaced in place, should: report the change", () => {
    expect(listChanged([{ id: 1 }], [{ id: 1 }])).toBe(true);
  });
});
