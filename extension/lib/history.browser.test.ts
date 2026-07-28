// The no-double-count guarantee in a real browser's IndexedDB, across a simulated
// MV3 teardown. A torn-down service worker keeps nothing in memory; only the store
// on disk survives. So "teardown" here is opening a fresh IndexedDbHistory against
// the same database — a new instance with no memory, which must read the persisted
// cursor and refuse to re-count samples the previous instance already drained.
//
// This runs the real IndexedDbHistory (real transactions, the atomic commit) in
// Chromium, which the in-memory unit tests deliberately cannot. The fast tests
// prove the cursor logic; this proves the storage engine honours it.

import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySample } from "@core/telemetry";
import type { DishWindow } from "@core/drain";
import { applyDrain, IndexedDbHistory } from "./history";

const MINUTE = 1_785_000_000;
let dbCounter = 0;
const openDatabases: string[] = [];

function sample(secondIntoMinute: number, powerW: number): TelemetrySample {
  return {
    timestampMs: (MINUTE + secondIntoMinute) * 1000,
    latencyMs: null,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  };
}

function window(count: number, powerW: number): DishWindow {
  return {
    samples: Array.from({ length: count }, (_, second) => sample(second, powerW)),
    newestCounter: count,
  };
}

/** A fresh store on its own database, so tests never see each other's data. */
async function freshStoreName(): Promise<string> {
  const name = `history-test-${dbCounter++}`;
  openDatabases.push(name);
  return name;
}

async function totalWattSeconds(name: string): Promise<number> {
  const store = await IndexedDbHistory.open(name);
  const buckets = await store.readMinutes(MINUTE, MINUTE);
  return buckets.reduce((sum, bucket) => sum + bucket.wattSeconds, 0);
}

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  );
});

describe("IndexedDbHistory across a simulated teardown", () => {
  it("persists a drained minute to real IndexedDB", async () => {
    const name = await freshStoreName();
    await applyDrain(await IndexedDbHistory.open(name), window(60, 10));
    expect(await totalWattSeconds(name)).toBe(600);
  });

  it("a fresh instance reads the persisted cursor and does not re-count", async () => {
    const name = await freshStoreName();
    // First worker: drain and commit, then vanish.
    await applyDrain(await IndexedDbHistory.open(name), window(60, 10));
    // Next worker: brand-new instance, no memory of the last drain.
    await applyDrain(await IndexedDbHistory.open(name), window(60, 10));
    expect(await totalWattSeconds(name)).toBe(600);
  });

  it("totals a minute split across two workers without double-counting", async () => {
    const name = await freshStoreName();
    await applyDrain(await IndexedDbHistory.open(name), { samples: window(30, 10).samples, newestCounter: 30 });
    // A teardown here loses the in-memory cursor; the fresh instance recovers it.
    await applyDrain(await IndexedDbHistory.open(name), { samples: window(60, 10).samples, newestCounter: 60 });
    const store = await IndexedDbHistory.open(name);
    const [bucket] = await store.readMinutes(MINUTE, MINUTE);
    expect(bucket?.samples).toBe(60);
    expect(bucket?.wattSeconds).toBe(600);
  });

  it("stays put across repeated fresh-instance drains of an unchanged window", async () => {
    const name = await freshStoreName();
    await applyDrain(await IndexedDbHistory.open(name), window(45, 8));
    await applyDrain(await IndexedDbHistory.open(name), window(45, 8));
    await applyDrain(await IndexedDbHistory.open(name), window(45, 8));
    expect(await totalWattSeconds(name)).toBe(360);
  });
});
