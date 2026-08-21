// What is asserted here is the thing that makes several rules on one device safe:
// the block belongs to the device, so it is owed while any rule holds it and
// lifted only when none does — whatever became of the rule that first asked for
// it. Every way a rule can end is the same case to this file.

import { describe, expect, it } from "vitest";
import { createRule, type MeterRule } from "./dataMeter";
import {
  blocksLanded,
  clearSettledOverrides,
  deviceHeld,
  forgetSettled,
  notePause,
  pausesOwed,
  releasedByHand,
  releasesOwed,
  type DevicePause,
  type DevicePauses,
} from "./devicePause";

const KEY = "2806438232";
const GB = 1_000_000_000;
const T0 = new Date(2026, 7, 12, 15, 30, 0).getTime();
const RETRY = 60_000;

function rule(over: Partial<MeterRule> = {}): MeterRule {
  return {
    ...createRule({
      clientKey: KEY,
      allocationBytes: 20 * GB,
      cycle: { kind: "daily" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    }),
    ...over,
  };
}

const pauses = (...held: DevicePause[]): DevicePauses =>
  new Map(held.map((pause) => [pause.clientKey, pause]));

describe("a device under several rules", () => {
  it("given: one of two rules holding it, should: read as held", () => {
    const held = [rule({ groupId: "kids", actedThisCycle: true }), rule({ groupId: "night" })];
    expect(deviceHeld(held, KEY)).toBe(true);
  });

  it("given: neither rule holding it, should: read as free", () => {
    expect(deviceHeld([rule({ groupId: "kids" }), rule({ groupId: "night" })], KEY)).toBe(false);
  });

  it("given: two rules holding it, should: owe one write rather than one apiece", () => {
    const both = [
      rule({ groupId: "kids", actedThisCycle: true }),
      rule({ groupId: "night", windowBlocked: true, windowActed: true }),
    ];
    expect(pausesOwed(both, new Map(), T0, RETRY)).toEqual([KEY]);
  });

  it("given: one rule let go and another still holding, should: owe no release", () => {
    // The whole point of the reference count: a timer running out does not open a
    // device its allowance is still holding shut.
    const still = [
      rule({ groupId: "kids", actedThisCycle: true }),
      rule({ groupId: "night", countdownMs: 3_600_000, countdownActed: false }),
    ];
    const applied = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(releasesOwed(still, applied, T0 + RETRY, RETRY)).toEqual([]);
  });

  it("given: the last rule letting go, should: owe the release", () => {
    const free = [rule({ groupId: "kids" }), rule({ groupId: "night" })];
    const applied = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(releasesOwed(free, applied, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: the rule that paused it deleted outright, should: still owe the release", () => {
    // The rule is the thing that asked for the block, never the thing that
    // remembers it. This is the case that used to leave a device blocked for ever
    // with nothing left that knew to free it.
    const applied = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(releasesOwed([], applied, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: a pause left pending by a rule that has since gone, should: owe the release", () => {
    // The other way a device is stranded: the write was recorded, the reply never
    // came — the process was killed, or the account never answered — and the rule
    // rolled before the retry. `pausesOwed` retries a pending only while a rule is
    // still holding, so nothing else would ever ask about this device again.
    const pending = pauses({
      clientKey: KEY,
      state: "pending",
      attempted: "pause",
      checkedMs: T0,
    });
    expect(releasesOwed([], pending, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: a pause still in flight, should: not race it with a release", () => {
    // Inside the window the write is simply not back yet. Releasing now can land
    // before the pause it is undoing and leave the device blocked by its own
    // release.
    const inFlight = pauses({
      clientKey: KEY,
      state: "pending",
      attempted: "pause",
      checkedMs: T0,
    });
    expect(releasesOwed([], inFlight, T0 + 1_000, RETRY)).toEqual([]);
  });
});

describe("pausesOwed", () => {
  const holding = [rule({ actedThisCycle: true })];

  it("given: a device never written for, should: owe the write at once", () => {
    expect(pausesOwed(holding, new Map(), T0, RETRY)).toEqual([KEY]);
  });

  it("given: the block already applied and landed, should: owe nothing", () => {
    const applied = pauses({ clientKey: KEY, state: "applied", checkedMs: T0, confirmedMs: T0 });
    expect(pausesOwed(holding, applied, T0 + RETRY, RETRY)).toEqual([]);
  });

  it("given: a block the router was never seen holding, should: send it again", () => {
    // The account taking the write is not the router applying it. Nothing else
    // asks after an "applied", so a write that was accepted and then quietly
    // dropped would leave the device unmetered for the rest of the cycle.
    const unlanded = pauses({
      clientKey: KEY,
      state: "applied",
      attempted: "pause",
      checkedMs: T0,
    });
    expect(pausesOwed(holding, unlanded, T0 + 1_000, RETRY)).toEqual([]);
    expect(pausesOwed(holding, unlanded, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: a write that failed, should: owe a retry once the window is up", () => {
    const failed = pauses({
      clientKey: KEY,
      state: "failed",
      attempted: "pause",
      checkedMs: T0,
    });
    expect(pausesOwed(holding, failed, T0 + 1_000, RETRY)).toEqual([]);
    expect(pausesOwed(holding, failed, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: a write still in flight past the window, should: try again", () => {
    // A write settles in seconds, so a pending older than the whole window never
    // came back and is as stalled as one that failed outright.
    const pending = pauses({
      clientKey: KEY,
      state: "pending",
      attempted: "pause",
      checkedMs: T0,
    });
    expect(pausesOwed(holding, pending, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: a device unpaused by hand, should: leave it alone", () => {
    // The latch is still set, so the rule still holds it; the person is the
    // authority, and re-pausing on the next poll would overrule them.
    const byHand = pauses({
      clientKey: KEY,
      state: "none",
      attempted: "release",
      checkedMs: T0,
      overridden: true,
    });
    expect(pausesOwed(holding, byHand, T0 + RETRY * 10, RETRY)).toEqual([]);
  });

  it("given: a write attempted but not landed, should: still owe the pause", () => {
    // The state a device reaches when the router is asked to hold it and then
    // reports it free without anyone touching it. Being unblocked is not the same
    // fact as someone having decided it should be, so this is still owed.
    const missed = pauses({ clientKey: KEY, state: "none", attempted: "pause", checkedMs: T0 });
    expect(pausesOwed(holding, missed, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: the hold behind an override ending, should: enforce the next one", () => {
    const overridden = pauses({ clientKey: KEY, state: "none", overridden: true });
    // Nothing holds the device now, so the person's release has nothing left to
    // overrule and the record stops carrying it.
    const settled = clearSettledOverrides(overridden, [rule()]);
    expect(settled.get(KEY)?.overridden).toBeUndefined();
    expect(pausesOwed(holding, settled, T0 + RETRY, RETRY)).toEqual([KEY]);
  });

  it("given: the rules still holding it, should: keep the override standing", () => {
    const overridden = pauses({ clientKey: KEY, state: "none", overridden: true });
    expect(clearSettledOverrides(overridden, holding)).toBe(overridden);
  });

  it("given: a rule that only watches, should: owe no write", () => {
    const watching = [rule({ autoPause: false, actedThisCycle: true })];
    expect(pausesOwed(watching, new Map(), T0, RETRY)).toEqual([]);
  });
});

describe("blocksLanded", () => {
  const sent = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });

  it("stamps a block the router is now seen holding", () => {
    expect(blocksLanded(sent, new Map([[KEY, true]]))).toEqual([KEY]);
  });

  it("stamps nothing while the roster has yet to catch up", () => {
    expect(blocksLanded(sent, new Map([[KEY, false]]))).toEqual([]);
  });

  it("reads a device the poll did not carry as not asked, never as unblocked", () => {
    expect(blocksLanded(sent, new Map())).toEqual([]);
  });

  it("stamps a block only once, so the landing keeps its own time", () => {
    const landed = pauses({ clientKey: KEY, state: "applied", checkedMs: T0, confirmedMs: T0 });
    expect(blocksLanded(landed, new Map([[KEY, true]]))).toEqual([]);
  });
});

describe("releasedByHand", () => {
  const landed = pauses({ clientKey: KEY, state: "applied", confirmedMs: T0 });

  it("finds a device the router reports unblocked", () => {
    expect(releasedByHand(landed, new Map([[KEY, false]]))).toEqual([KEY]);
  });

  it("leaves it alone while the router still reports it blocked", () => {
    expect(releasedByHand(landed, new Map([[KEY, true]]))).toEqual([]);
  });

  it("reads a device the poll did not carry as not asked, never as unblocked", () => {
    expect(releasedByHand(landed, new Map())).toEqual([]);
  });

  it("given: a write the roster has yet to carry, should: claim nobody released it", () => {
    // The whole reason the landing is stamped. A block spends its first seconds
    // sent but not yet on the roster, which reads exactly like a device someone
    // freed — and answering that with an override would exempt the device from
    // the rule that had just paused it, for as long as that rule held it.
    const sent = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(releasedByHand(sent, new Map([[KEY, false]]))).toEqual([]);
  });
});

describe("notePause", () => {
  it("hands back the same map when nothing moved, so no write follows", () => {
    const held = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(notePause(held, KEY, { state: "applied", checkedMs: T0 })).toBe(held);
  });

  it("hands back a new map when the state moves", () => {
    const held = pauses({ clientKey: KEY, state: "applied", checkedMs: T0 });
    expect(notePause(held, KEY, { state: "none", checkedMs: T0 })).not.toBe(held);
  });
});

describe("forgetSettled", () => {
  it("drops a record for a device nothing meters and nothing is holding", () => {
    const settled = pauses({ clientKey: KEY, state: "none" });
    expect(forgetSettled(settled, []).size).toBe(0);
  });

  it("keeps a record of a device the router is still holding", () => {
    // Kept even with no rule left: it is the only thing that knows to free it.
    const applied = pauses({ clientKey: KEY, state: "applied" });
    expect(forgetSettled(applied, []).size).toBe(1);
  });

  it("keeps a settled record while a rule still meters the device", () => {
    const settled = pauses({ clientKey: KEY, state: "none" });
    expect(forgetSettled(settled, [rule()]).size).toBe(1);
  });
});
