// The store's own job, on top of the shared decision core: rules that survive a
// restart, follow a device whose identity the router reissued, and distinguish
// editing a rule from starting its allowance over.

import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeterStore } from "./meterStore.mts";
import { usageBytes } from "../core/dataMeter.ts";

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
    store.resolve(
      (key) => (key === "111" ? "222" : key),
      () => true,
    );
    expect(store.find("111")).toBeUndefined();
    expect(store.find("222")).toBeDefined();
  });

  it("drops a rule whose device no longer has a record", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.resolve(
      (key) => key,
      () => false,
    );
    expect(store.all()).toEqual([]);
  });

  it("keeps one rule when two identities merge into a single device", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.upsert({
      clientKey: "222",
      allocationBytes: 5 * GB,
      cycle: { kind: "monthly", day: 1 },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    });
    store.resolve(
      (key) => (key === "111" ? "222" : key),
      () => true,
    );
    expect(store.all()).toHaveLength(1);
    expect(store.find("222")!.allocationBytes).toBe(50 * GB);
  });

  it("reports a pause that could not be sent as failed, not as applied", () => {
    const store = new MeterStore(tempPath());
    withRule(store, "111");
    store.notePauseState("111", "failed", T0);
    expect(store.find("111")!.pauseState).toBe("failed");
    expect(store.find("111")!.pauseCheckedMs).toBe(T0);
  });
});
