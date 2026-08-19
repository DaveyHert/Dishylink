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
  releasedByHand,
  stalledReleases,
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
    expect(rules[0].pauseState).toBe("pending");
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
    expect(rules[0].pauseState).toBe("none");
    expect(usageBytes(rules[0])).toBe(50 * GB);
  });

  it("announces a spent allowance once per cycle, not on every poll", () => {
    const watching = rule({ autoPause: false });
    const first = evaluateMeters([watching], read(50 * GB), T0 + 1_000);
    const second = evaluateMeters(first.rules, read(60 * GB), T0 + 2_000);
    expect(second.transitions).toEqual([]);
  });

  it("releases the pause it applied when the cycle rolls, and re-anchors", () => {
    const tripped = rule({ pauseState: "applied", actedThisCycle: true });
    const tomorrow = T0 + 86_400_000;
    const { rules, transitions } = evaluateMeters([tripped], read(25 * GB), tomorrow);
    expect(transitions.map((t) => t.kind)).toEqual(["released"]);
    expect(rules[0].pauseState).toBe("none");
    expect(rules[0].actedThisCycle).toBe(false);
    expect(usageBytes(rules[0])).toBe(0);
  });

  it("rolls a cycle for a device that is offline, so its pause is still released", () => {
    const tripped = rule({
      pauseState: "applied",
      actedThisCycle: true,
      observedRx: 25 * GB,
    });
    // No reading at all: the device is away, its counter frozen where it stopped.
    const { rules, transitions } = evaluateMeters([tripped], [], T0 + 86_400_000);
    expect(transitions.map((t) => t.kind)).toEqual(["released"]);
    expect(rules[0].anchorRx).toBe(25 * GB);
    expect(usageBytes(rules[0])).toBe(0);
  });

  it("leaves a device the user unpaused by hand alone for the rest of the cycle", () => {
    let rules = [rule()];
    rules = evaluateMeters(rules, read(21 * GB), T0 + 1_000).rules;
    expect(rules[0].actedThisCycle).toBe(true);
    // The user unpauses; the meter must not answer by pausing it again.
    rules[0] = { ...rules[0], pauseState: "none" };
    const later = evaluateMeters(rules, read(40 * GB), T0 + 2_000);
    expect(later.transitions).toEqual([]);
  });

  it("does not release a pause the meter never applied", () => {
    const untripped = rule({ pauseState: "none" });
    const { transitions } = evaluateMeters([untripped], read(1 * GB), T0 + 86_400_000);
    expect(transitions).toEqual([]);
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

describe("stalledReleases", () => {
  const pausing = (over: Partial<MeterRule> = {}) =>
    rule({ pauseState: "applied", pauseCheckedMs: T0, ...over });

  it("owes an unpause on a device paused under its allowance", () => {
    expect(stalledReleases([pausing()], T0 + 60_000, 60_000)).toHaveLength(1);
  });

  it("owes nothing while the device is still over its allowance", () => {
    expect(stalledReleases([pausing({ observedRx: 30 * GB })], T0 + 60_000, 60_000)).toEqual([]);
  });

  it("owes nothing inside the retry window", () => {
    expect(stalledReleases([pausing()], T0 + 1_000, 60_000)).toEqual([]);
  });

  it("owes nothing on a rule that is pausing nothing", () => {
    expect(stalledReleases([rule({ pauseState: "none" })], T0 + 60_000, 60_000)).toEqual([]);
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
    expect(rules[0].pauseState).toBe("none");
  });

  it("given: the time is up, should: pause the device even having spent nothing", () => {
    const { rules, transitions } = evaluateMeters([timer()], read(0), T0 + 2 * HOUR);
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
    expect(rules[0].pauseState).toBe("pending");
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

  it("given: a cycle asked for alongside a countdown, should: hold it on one that never rolls", () => {
    const written = createRule({
      clientKey: KEY,
      allocationBytes: 0,
      cycle: { kind: "daily" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: HOUR,
    });
    expect(written.cycle).toEqual({ kind: "once" });
    expect(written.periodEndMs).toBe(Number.POSITIVE_INFINITY);
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

  it("given: a timer that is up and paused, should: owe no release while the time stays up", () => {
    const held = timer({ pauseState: "applied", periodStartMs: T0 - 3 * HOUR });
    expect(stalledReleases([held], T0 + 60_000, 60_000)).toEqual([]);
  });

  it("given: a timer restarted, should: owe the release its pause is holding", () => {
    const held = restartCycle(timer({ pauseState: "applied" }), T0);
    expect(held.pauseState).toBe("none");
    expect(countdownLeftMs(held, T0)).toBe(2 * HOUR);
  });
});

describe("releasedByHand", () => {
  const pausing = rule({ pauseState: "applied" });

  it("finds a rule claiming a device the router reports unpaused", () => {
    expect(releasedByHand([pausing], new Map([[KEY, false]]))).toHaveLength(1);
  });

  it("leaves the rule alone while the router still reports the device paused", () => {
    expect(releasedByHand([pausing], new Map([[KEY, true]]))).toEqual([]);
  });

  it("reads a device the poll did not carry as not asked, never as unpaused", () => {
    expect(releasedByHand([pausing], new Map())).toEqual([]);
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
