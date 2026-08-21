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

/** The one rule this store holds for a device. Every case here writes one. */
function only(store: MeterStore, clientKey = "111"): MeterRule | undefined {
  return store.forDevice(clientKey)[0];
}

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
  const rule = only(store, "111")!;
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
    expect(only(reopened, "111")?.allocationBytes).toBe(50 * GB);
  });

  it("keeps a countdown running across a restart", () => {
    const path = tempPath();
    new MeterStore(path).upsert({
      clientKey: "111",
      allocationBytes: 0,
      cycle: { kind: "once" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
      countdownMs: 30 * 60_000,
    });
    // The snapshot cannot hold the Infinity a countdown's cycle ends on, and read
    // back as nothing it is a boundary already past: the cycle rolls on the first
    // poll and takes the countdown's own start with it.
    const reopened = new MeterStore(path);
    const transitions = reopened.observe(
      [{ clientKey: "111", lifetimeRx: 1_000, lifetimeTx: 0 }],
      T0 + 60_000,
    );
    expect(transitions).toEqual([]);
    expect(only(reopened, "111")?.periodStartMs).toBe(T0);
  });

  it("keeps what a one-off allowance has spent across a restart", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    store.upsert({
      clientKey: "111",
      allocationBytes: 50 * GB,
      cycle: { kind: "once" },
      lifetimeRx: 1 * GB,
      lifetimeTx: 0,
      nowMs: T0,
    });
    store.observe([{ clientKey: "111", lifetimeRx: 3 * GB, lifetimeTx: 0 }], T0 + 60_000);
    expect(usageBytes(only(store, "111")!)).toBe(2 * GB);

    const reopened = new MeterStore(path);
    reopened.observe([{ clientKey: "111", lifetimeRx: 3 * GB, lifetimeTx: 0 }], T0 + 120_000);
    expect(usageBytes(only(reopened, "111")!)).toBe(2 * GB);
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
    expect(usageBytes(only(store, "111")!)).toBe(20 * GB);
    // Raising the limit must not hand the device a fresh allowance.
    store.upsert({
      clientKey: "111",
      allocationBytes: 80 * GB,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 30 * GB,
      lifetimeTx: 0,
      nowMs: T0 + 2_000,
    });
    expect(usageBytes(only(store, "111")!)).toBe(20 * GB);
    expect(only(store, "111")!.allocationBytes).toBe(80 * GB);
  });

  it("keeps a device's own rule's original creation time across an edit", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111", 10 * GB);
    const createdMs = only(store, "111")!.createdMs;
    store.upsert({
      clientKey: "111",
      allocationBytes: 80 * GB,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 10 * GB,
      lifetimeTx: 0,
      nowMs: T0 + 2_000,
    });
    expect(only(store, "111")!.createdMs).toBe(createdMs);
    expect(only(store, "111")!.updatedMs).toBe(T0 + 2_000);
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
    expect(usageBytes(only(store, "111")!)).toBe(20 * GB);
    expect(only(store, "111")!.cycle).toEqual({ kind: "daily" });
    expect(only(store, "111")!.periodEndMs).toBeGreaterThan(T0 + 2_000);
  });

  it("arms the rule again when the allowance is raised past what was spent", () => {
    const store = new MeterStore(tempPath());
    tripped(store, 1 * GB, 2 * GB);
    store.notePauseState("111", "failed", T0 + 1_000, "cloud proxy answered 502");
    expect(only(store, "111")!.actedThisCycle).toBe(true);

    setAllowance(store, 3 * GB);

    const armed = only(store, "111")!;
    expect(armed.actedThisCycle).toBe(false);
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
    expect(only(store, "111")!.actedThisCycle).toBe(true);
    const pause = store.pauses().get("111");
    expect(pause?.state).toBe("failed");
    expect(pause?.error).toBe("cloud proxy answered 502");
  });

  it("clears what a rule counted without touching the device's own counter", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111", 10 * GB);
    store.observe([{ clientKey: "111", lifetimeRx: 30 * GB, lifetimeTx: 0 }], T0 + 1_000);
    const [restarted] = store.restart({ clientKey: "111" }, T0 + 2_000);
    expect(usageBytes(restarted!)).toBe(0);
    // The counter it reads is untouched, so the next reading measures from here.
    store.observe([{ clientKey: "111", lifetimeRx: 31 * GB, lifetimeTx: 0 }], T0 + 3_000);
    expect(usageBytes(only(store, "111")!)).toBe(1 * GB);
  });

  it("follows a device whose identity the router reissued", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.resolve({ keys: ["222"], resolveKey: (key) => (key === "111" ? "222" : key) });
    expect(only(store, "111")).toBeUndefined();
    expect(only(store, "222")).toBeDefined();
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
    expect(only(store, "222")!.allocationBytes).toBe(5 * GB);
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
    expect(only(store, "222")!.allocationBytes).toBe(40 * GB);
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
    // The block belongs to the device, so a rule that stops enforcing does not by
    // itself free it; the poll releases a device no rule is holding.
    expect(only(store, "111")!.autoPause).toBe(false);
  });

  it("reports a pause that could not be sent as failed, not as applied", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0);
    expect(store.pauses().get("111")?.state).toBe("failed");
    expect(store.pauses().get("111")?.checkedMs).toBe(T0);
  });

  it("keeps why a pause failed, and survives a reload", () => {
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "cloud proxy answered 502");
    expect(new MeterStore(path).pauses().get("111")?.error).toBe("cloud proxy answered 502");
  });

  it("keeps the block on a device whose rules are all gone, so something can free it", () => {
    // Nothing else knows the router is holding it: the rule that asked for the
    // block was never the thing that remembered it.
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.notePauseState("111", "applied", T0);
    store.remove("111");
    expect(store.pauses().get("111")?.state).toBe("applied");
    expect(new MeterStore(path).pauses().get("111")?.state).toBe("applied");
  });

  it("writes the landing to disk, so a restart does not re-open the question", () => {
    // The landing moves no other field on the record, so the guard that skips a
    // write when nothing changed is exactly what would swallow it — and a reload
    // that reads a landed block as unlanded is the whole bug back again.
    const path = tempPath();
    const store = new MeterStore(path);
    withRule(store, "111");
    store.notePauseState("111", "applied", T0);
    store.noteBlockLanded("111", T0 + 200);
    expect(new MeterStore(path).pauses().get("111")?.confirmedMs).toBe(T0 + 200);
  });

  it("keeps the landing while a release will not go through", () => {
    // The block never moved, so neither did the router having been seen holding
    // it. Losing it here would leave a device nobody could tell had been freed
    // by hand.
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "applied", T0);
    store.noteBlockLanded("111", T0 + 200);
    store.noteAttempt("111", "release", T0 + 1_000);
    store.notePauseState("111", "applied", T0 + 1_000, "cloud proxy answered 502");
    expect(store.pauses().get("111")?.confirmedMs).toBe(T0 + 200);
  });

  it("drops the landing when a fresh write goes out, so it is not read off the last one", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "applied", T0);
    store.noteBlockLanded("111", T0 + 200);
    store.notePauseState("111", "pending", T0 + 60_000);
    store.notePauseState("111", "applied", T0 + 60_100);
    expect(store.pauses().get("111")?.confirmedMs).toBeUndefined();
  });

  it("replaces the reason when a retry fails differently", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "first reason");
    store.notePauseState("111", "pending", T0 + 1);
    store.notePauseState("111", "failed", T0 + 2, "second reason");
    expect(store.pauses().get("111")?.error).toBe("second reason");
  });

  it("drops the reason once a pause lands, so a stale one cannot be read back", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0, "cloud proxy answered 502");
    store.notePauseState("111", "applied", T0 + 1);
    expect(store.pauses().get("111")?.error).toBeUndefined();
  });

  it("restarting a cycle stops the rule holding the device", () => {
    const store = new MeterStore(tempPath());
    tripped(store, 1 * GB, 5 * GB);
    expect(only(store, "111")!.actedThisCycle).toBe(true);
    store.restart({ clientKey: "111" }, T0 + 1);
    expect(only(store, "111")!.actedThisCycle).toBe(false);
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
    createdMs: T0,
  });
  const counters = (keys: string[]) =>
    keys.map((clientKey) => ({ clientKey, lifetimeRx: 0, lifetimeTx: 0 }));

  it("writes a rule for every member", () => {
    const store = new MeterStore(tempPath());
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    expect(store.all().map((rule) => rule.clientKey)).toEqual(["111", "222"]);
  });

  it("keeps the block on a member it drops, so the poll can still release it", () => {
    const store = new MeterStore(tempPath());
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    store.notePauseState("222", "applied", T0);
    const went = store.project([group(["111"])], counters(["111", "222"]), T0 + 1);
    expect(went.dropped.map((rule) => rule.clientKey)).toEqual(["222"]);
    expect(only(store, "222")).toBeUndefined();
    // Nothing holds the device now, and this is what the release is owed against.
    expect(store.pauses().get("222")?.state).toBe("applied");
  });

  it("leaves a device's own rule standing when it joins a group", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.project([group(["111", "222"])], counters(["111", "222"]), T0 + 1);
    // Two rules on 111 now: the one it carried, and the group's.
    expect(store.forDevice("111")).toHaveLength(2);
    expect(store.forDevice("111").filter((rule) => rule.groupId === "kids")).toHaveLength(1);
  });

  it("starts the whole group over from one member, and no fellow member's own rule", () => {
    // The group's cycle is one cycle, so its members re-anchor together. A limit
    // another member set on itself is a different rule, and this is not about it.
    const store = new MeterStore(tempPath());
    withRule(store, "222", 30 * GB);
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    store.observe(
      [
        { clientKey: "111", lifetimeRx: 10 * GB, lifetimeTx: 0 },
        { clientKey: "222", lifetimeRx: 40 * GB, lifetimeTx: 0 },
      ],
      T0 + 1_000,
    );
    store.restart({ groupId: "kids" }, T0 + 2_000);

    const spent = (clientKey: string, groupId?: string) =>
      usageBytes(store.forDevice(clientKey).find((rule) => rule.groupId === groupId)!);
    expect(spent("111", "kids")).toBe(0);
    expect(spent("222", "kids")).toBe(0);
    expect(spent("222")).toBe(10 * GB);
  });

  it("restarts one rule without touching another naming the same device", () => {
    // A phone under a monthly allowance with three other devices, and a half-hour
    // timer of its own beside it. Restarting the timer must not hand back the
    // month — least of all the other three devices', which share the phone's
    // group and never had a timer at all.
    const store = new MeterStore(tempPath());
    const timer = {
      groupId: "sitting",
      name: "My phone use",
      memberKeys: ["111"],
      allocationBytes: 0,
      autoPause: true,
      cycle: { kind: "once" } as const,
      mode: "perMember" as const,
      countdownMs: 1_800_000,
      updatedMs: T0,
      createdMs: T0,
    };
    store.project([group(["111", "222"]), timer], counters(["111", "222"]), T0);
    store.observe(
      [
        { clientKey: "111", lifetimeRx: 5 * GB, lifetimeTx: 0 },
        { clientKey: "222", lifetimeRx: 7 * GB, lifetimeTx: 0 },
      ],
      T0 + 1_000,
    );

    store.restart({ groupId: "sitting" }, T0 + 2_000);

    const spent = (clientKey: string, groupId: string) =>
      usageBytes(store.forDevice(clientKey).find((rule) => rule.groupId === groupId)!);
    expect(spent("111", "sitting")).toBe(0);
    // The month stands, on the phone and on every device sharing its allowance.
    expect(spent("111", "kids")).toBe(5 * GB);
    expect(spent("222", "kids")).toBe(7 * GB);
  });

  it("restarts a device's own rule without touching the groups naming it", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.project([group(["111", "222"])], counters(["111", "222"]), T0);
    store.observe([{ clientKey: "111", lifetimeRx: 9 * GB, lifetimeTx: 0 }], T0 + 1_000);

    store.restart({ clientKey: "111" }, T0 + 2_000);

    const spent = (clientKey: string, groupId?: string) =>
      usageBytes(store.forDevice(clientKey).find((rule) => rule.groupId === groupId)!);
    expect(spent("111")).toBe(0);
    expect(spent("111", "kids")).toBe(9 * GB);
  });

  it("drops only the rule a device carries itself, leaving its groups' alone", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.project([group(["111", "222"])], counters(["111", "222"]), T0 + 1);

    expect(store.removeOwn("111")).toBe(true);
    expect(store.forDevice("111").map((rule) => rule.groupId)).toEqual(["kids"]);
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
