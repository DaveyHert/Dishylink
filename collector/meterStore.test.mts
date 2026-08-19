// The store's own job, on top of the shared decision core: rules that survive a
// restart, follow a device whose identity the router reissued, and distinguish
// editing a rule from starting its allowance over.

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeterStore } from "./meterStore.mts";
import { usageBytes } from "../core/dataMeter.ts";
import type { MeterRule } from "../core/dataMeter.ts";
import type { DeviceGroup } from "../core/deviceGroup.ts";

const GB = 1_000_000_000;
const T0 = new Date(2026, 7, 12, 15, 30, 0).getTime();
const paths: string[] = [];

function tempPath(): string {
  const path = join(tmpdir(), `meters-${Math.random().toString(36).slice(2)}.json`);
  paths.push(path);
  return path;
}
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

function withRule(store: MeterStore, clientKey = "111", lifetimeRx = 0) {
  return store.upsert({
    clientKey,
    allocationBytes: 50 * GB,
    cycle: { kind: "monthly", day: 1 },
    lifetimeRx,
    lifetimeTx: 0,
    nowMs: T0,
  });
}

const METERED_CYCLE = { kind: "monthly", day: 1 } as const;

/** A rule that has already spent `spent` against `allowance`, so it is latched. */
function tripped(store: MeterStore, allowance: number, spent: number) {
  store.upsert({
    clientKey: "111",
    allocationBytes: allowance,
    cycle: METERED_CYCLE,
    lifetimeRx: 0,
    lifetimeTx: 0,
    nowMs: T0,
  });
  store.observe([{ clientKey: "111", lifetimeRx: spent, lifetimeTx: 0 }], T0 + 1_000);
}

/** A new allowance, nothing else touched. */
function setAllowance(store: MeterStore, allowance: number) {
  const rule = store.find("111")!;
  store.upsert({
    clientKey: "111",
    allocationBytes: allowance,
    cycle: METERED_CYCLE,
    lifetimeRx: rule.observedRx,
    lifetimeTx: rule.observedTx,
    nowMs: T0 + 2_000,
  });
}

describe("MeterStore", () => {
  it("reloads its rules after a restart", () => {
    const path = tempPath();
    withRule(new MeterStore(path));
    const reopened = new MeterStore(path);
    expect(reopened.all()).toHaveLength(1);
    expect(reopened.find("111")?.allocationBytes).toBe(50 * GB);
  });

  it("starts with no rules on a snapshot it cannot read", () => {
    const path = tempPath();
    withRule(new MeterStore(path));
    rmSync(path);
    expect(new MeterStore(path).all()).toEqual([]);
  });

  it("keeps the running cycle when a limit is edited", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111", 10 * GB);
    store.observe([{ clientKey: "111", lifetimeRx: 30 * GB, lifetimeTx: 0 }], T0 + 1_000);
    expect(usageBytes(store.find("111")!)).toBe(20 * GB);
    // Raising the limit must not hand the device a fresh allowance.
    store.upsert({
      clientKey: "111",
      allocationBytes: 80 * GB,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 30 * GB,
      lifetimeTx: 0,
      nowMs: T0 + 2_000,
    });
    expect(usageBytes(store.find("111")!)).toBe(20 * GB);
    expect(store.find("111")!.allocationBytes).toBe(80 * GB);
  });

  it("keeps what a device has spent when the cycle kind changes", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111", 10 * GB);
    store.observe([{ clientKey: "111", lifetimeRx: 30 * GB, lifetimeTx: 0 }], T0 + 1_000);
    store.upsert({
      clientKey: "111",
      allocationBytes: 50 * GB,
      cycle: { kind: "daily" },
      lifetimeRx: 30 * GB,
      lifetimeTx: 0,
      nowMs: T0 + 2_000,
    });
    // Editing a rule is not a reset: only restart() clears the count, and it has
    // a control of its own. The new cycle moves its boundaries, nothing else.
    expect(usageBytes(store.find("111")!)).toBe(20 * GB);
    expect(store.find("111")!.cycle).toEqual({ kind: "daily" });
    expect(store.find("111")!.periodEndMs).toBeGreaterThan(T0 + 2_000);
  });

  it("arms the rule again when the allowance is raised past what was spent", () => {
    const store = new MeterStore(tempPath());
    tripped(store, 1 * GB, 2 * GB);
    store.notePauseState("111", "failed", T0 + 1_000, "cloud proxy answered 502");
    expect(store.find("111")!.actedThisCycle).toBe(true);

    setAllowance(store, 3 * GB);

    const armed = store.find("111")!;
    expect(armed.actedThisCycle).toBe(false);
    expect(armed.pauseState).toBe("none");
    expect(armed.pauseError).toBeUndefined();
    expect(usageBytes(armed)).toBe(2 * GB);

    const transitions = store.observe(
      [{ clientKey: "111", lifetimeRx: 4 * GB, lifetimeTx: 0 }],
      T0 + 3_000,
    );
    expect(transitions.map((t) => t.kind)).toEqual(["reached"]);
  });

  it("holds the trip when the raised allowance is still under what was spent", () => {
    const store = new MeterStore(tempPath());
    tripped(store, 1 * GB, 5 * GB);
    store.notePauseState("111", "failed", T0 + 1_000, "cloud proxy answered 502");
    setAllowance(store, 2 * GB);
    const rule = store.find("111")!;
    expect(rule.actedThisCycle).toBe(true);
    expect(rule.pauseState).toBe("failed");
    expect(rule.pauseError).toBe("cloud proxy answered 502");
  });

  it("clears what a rule counted without touching the device's own counter", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111", 10 * GB);
    store.observe([{ clientKey: "111", lifetimeRx: 30 * GB, lifetimeTx: 0 }], T0 + 1_000);
    const restarted = store.restart("111", T0 + 2_000);
    expect(usageBytes(restarted!)).toBe(0);
    // The counter it reads is untouched, so the next reading measures from here.
    store.observe([{ clientKey: "111", lifetimeRx: 31 * GB, lifetimeTx: 0 }], T0 + 3_000);
    expect(usageBytes(store.find("111")!)).toBe(1 * GB);
  });

  it("follows a device whose identity the router reissued", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.resolve({ keys: ["222"], resolveKey: (key) => (key === "111" ? "222" : key) });
    expect(store.find("111")).toBeUndefined();
    expect(store.find("222")).toBeDefined();
  });

  it("drops a rule whose device no longer has a record", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.resolve({ keys: ["999"], resolveKey: (key) => key });
    expect(store.all()).toEqual([]);
  });

  it("keeps every rule when the recorder has folded no reading yet", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.resolve({ keys: [], resolveKey: (key) => key });
    expect(store.all()).toHaveLength(1);
    expect(new MeterStore(path).all()).toHaveLength(1);
  });

  const mergeInto222 = {
    keys: ["222"],
    resolveKey: (key: string) => (key === "111" ? "222" : key),
  };

  it("keeps the newer id's rule when it was the one set last", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.upsert({
      clientKey: "222",
      allocationBytes: 5 * GB,
      cycle: METERED_CYCLE,
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0 + 1_000,
    });
    store.resolve(mergeInto222);
    expect(store.all()).toHaveLength(1);
    expect(store.find("222")!.allocationBytes).toBe(5 * GB);
  });

  it("keeps the older id's rule when that is the one set last", () => {
    const store = new MeterStore(tempPath());
    store.upsert({
      clientKey: "222",
      allocationBytes: 5 * GB,
      cycle: METERED_CYCLE,
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    });
    withRule(store, "111");
    setAllowance(store, 40 * GB);
    store.resolve(mergeInto222);
    expect(store.all()).toHaveLength(1);
    expect(store.find("222")!.allocationBytes).toBe(40 * GB);
  });

  it("drops an owed pause when the rule stops enforcing", () => {
    const store = new MeterStore(tempPath());
    tripped(store, 1 * GB, 2 * GB);
    store.notePauseState("111", "failed", T0 + 1_000, "cloud proxy answered 502");
    store.upsert({
      clientKey: "111",
      allocationBytes: 1 * GB,
      autoPause: false,
      cycle: METERED_CYCLE,
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0 + 2_000,
    });
    expect(store.find("111")!.pauseState).toBe("none");
    expect(store.find("111")!.pauseError).toBeUndefined();
  });

  it("reports a pause that could not be sent as failed, not as applied", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0);
    expect(store.find("111")!.pauseState).toBe("failed");
    expect(store.find("111")!.pauseCheckedMs).toBe(T0);
  });

  it("reports whether any rule took the pause result", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    expect(store.notePauseState("111", "applied", T0)).toBe(true);
    expect(store.notePauseState("does-not-exist", "applied", T0)).toBe(false);
  });

  it("keeps why a pause failed, and survives a reload", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "cloud proxy answered 502");
    expect(new MeterStore(path).find("111")!.pauseError).toBe("cloud proxy answered 502");
  });

  it("replaces the reason when a retry fails differently", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "first reason");
    store.notePauseState("111", "pending", T0 + 1);
    store.notePauseState("111", "failed", T0 + 2, "second reason");
    expect(store.find("111")!.pauseError).toBe("second reason");
  });

  it("drops the reason once a pause lands, so a stale one cannot be read back", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "cloud proxy answered 502");
    store.notePauseState("111", "applied", T0 + 1);
    expect(store.find("111")!.pauseError).toBeUndefined();
  });

  it("restarting a cycle clears the reason with the state", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "cloud proxy answered 502");
    store.restart("111", T0 + 1);
    expect(store.find("111")!.pauseState).toBe("none");
    expect(store.find("111")!.pauseError).toBeUndefined();
  });
});

describe("projecting a group's rules", () => {
  const group = (memberKeys: string[]): DeviceGroup => ({
    groupId: "kids",
    name: "Kids",
    memberKeys,
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: METERED_CYCLE,
    mode: "pooled",
    updatedMs: T0,
  });
  const counters = (keys: string[]) =>
    keys.map((clientKey) => ({ clientKey, lifetimeRx: 0, lifetimeTx: 0 }));

  it("writes a rule for every member", () => {
    const store = new MeterStore(tempPath());
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    expect(store.all().map((rule) => rule.clientKey)).toEqual(["111", "222"]);
  });

  it("hands back a dropped member still holding its pause, so something can release it", () => {
    const store = new MeterStore(tempPath());
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    store.notePauseState("222", "applied", T0);
    const went = store.project([group(["111"])], counters(["111", "222"]), T0 + 1);
    expect(went.dropped.map((rule) => rule.clientKey)).toEqual(["222"]);
    expect(went.dropped[0].pauseState).toBe("applied");
    expect(store.find("222")).toBeUndefined();
  });

  it("hands back a rule whose announcement moved from the device to its group", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    const went = store.project([group(["111", "222"])], counters(["111", "222"]), T0 + 1);
    expect(went.reannounced.map((rule) => rule.clientKey)).toEqual(["111"]);
    expect(went.dropped).toEqual([]);
  });

  it("reports nothing gone on a poll that changes no terms", () => {
    const store = new MeterStore(tempPath());
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    const went = store.project([group(["111", "222"])], counters(["111", "222"]), T0 + 200);
    expect(went).toEqual({ dropped: [], reannounced: [] });
  });
});

describe("writing counters to disk", () => {
  /** What the file on disk says, which is what a restart would read back. */
  const storedRx = (path: string) =>
    (JSON.parse(readFileSync(path, "utf8")) as { rules: MeterRule[] }).rules[0].observedRx;

  it("holds a poll's advancing counters in memory rather than writing every poll", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    // The first observation flushes; the polls behind it are the ones that would
    // have the 200 ms cadence writing the file five times a second.
    store.observe([{ clientKey: "111", lifetimeRx: 1 * GB, lifetimeTx: 0 }], T0);
    store.observe([{ clientKey: "111", lifetimeRx: 2 * GB, lifetimeTx: 0 }], T0 + 200);
    store.observe([{ clientKey: "111", lifetimeRx: 3 * GB, lifetimeTx: 0 }], T0 + 400);

    expect(store.all()[0].observedRx).toBe(3 * GB);
    expect(storedRx(path)).toBe(1 * GB);
  });

  it("flushes them once the interval is up", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.observe([{ clientKey: "111", lifetimeRx: 1 * GB, lifetimeTx: 0 }], T0);
    store.observe([{ clientKey: "111", lifetimeRx: 9 * GB, lifetimeTx: 0 }], T0 + 30_000);

    expect(storedRx(path)).toBe(9 * GB);
  });

  it("writes a reached limit at once, whatever the flush is holding", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    store.upsert({
      clientKey: "111",
      allocationBytes: 2 * GB,
      cycle: METERED_CYCLE,
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    });
    store.observe([{ clientKey: "111", lifetimeRx: 1 * GB, lifetimeTx: 0 }], T0);
    // Well inside the flush interval, but an announcement is an event and the
    // record of it cannot wait on a timer.
    const transitions = store.observe(
      [{ clientKey: "111", lifetimeRx: 5 * GB, lifetimeTx: 0 }],
      T0 + 200,
    );

    expect(transitions.map((transition) => transition.kind)).toEqual(["reached"]);
    expect(storedRx(path)).toBe(5 * GB);
  });
});
