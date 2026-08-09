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
    await applyDrain(await IndexedDbHistory.open(name), {
      samples: window(30, 10).samples,
      newestCounter: 30,
    });
    // A teardown here loses the in-memory cursor; the fresh instance recovers it.
    await applyDrain(await IndexedDbHistory.open(name), {
      samples: window(60, 10).samples,
      newestCounter: 60,
    });
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

// The client stores prune by a lexical range delete over a fixed-width epoch
// prefix; a width mismatch would sort the bound past every key and silently wipe
// or keep the whole store. Only real IndexedDB orders strings the way the delete
// assumes, so the in-memory store (numeric compares) cannot catch this — it has
// to run here. Each reads back with a window far wider than retention, so what
// returns is what physically survived the prune, not what a read filter hides.
describe("IndexedDbHistory client-row pruning", () => {
  const NOW = 1_785_000_000_000;

  it("prunes client-minute rows past the 6h window and keeps the rest", async () => {
    const store = await IndexedDbHistory.open(await freshStoreName());
    const fresh = Math.floor(NOW / 60_000) * 60;
    const stale = fresh - 7 * 3_600; // 7h earlier — outside 6h
    await store.putClientMinutes(
      [
        {
          minute: stale,
          key: "1",
          macAddress: "aa",
          downMbps: 0,
          upMbps: 0,
          rxBytes: 0,
          txBytes: 0,
        },
        {
          minute: fresh,
          key: "1",
          macAddress: "aa",
          downMbps: 5,
          upMbps: 1,
          rxBytes: 0,
          txBytes: 0,
        },
      ],
      NOW,
    );
    const survived = await store.readClientMinutes(10_000, undefined, NOW);
    expect(survived.map((r) => r.minute)).toEqual([fresh]);
  });

  it("prunes raw samples past the window and keeps newer ones", async () => {
    const store = await IndexedDbHistory.open(await freshStoreName());
    const stale = NOW - 30 * 60_000; // 30min old — outside the 20min window
    const fresh = NOW - 60_000;
    await store.putClientSamples(
      [
        { key: "1", macAddress: "aa", atMs: stale, downMbps: 0, upMbps: 0 },
        { key: "1", macAddress: "aa", atMs: fresh, downMbps: 9, upMbps: 2 },
      ],
      NOW,
    );
    // Read floored below the stale sample, so a survivor would still show.
    const survived = await store.readClientSamples(0, undefined, stale);
    expect(survived.map((s) => s.atMs)).toEqual([fresh]);
  });
});

describe("IndexedDbHistory energy compaction", () => {
  const NOW_MS = Date.now();
  const CURRENT_YEAR_MINUTE = Math.floor(NOW_MS / 1000 / 60) * 60;
  const OLD_YEAR_MINUTE = CURRENT_YEAR_MINUTE - 3 * 365 * 24 * 3_600;

  it("folds a past year's minutes into a month row via a real transaction, and drops them", async () => {
    const store = await IndexedDbHistory.open(await freshStoreName());
    await store.commit(
      [
        {
          minute: OLD_YEAR_MINUTE,
          wattSeconds: 120,
          samples: 60,
          downlinkBits: 8e6,
          uplinkBits: 1e6,
        },
        {
          minute: CURRENT_YEAR_MINUTE,
          wattSeconds: 50,
          samples: 60,
          downlinkBits: 0,
          uplinkBits: 0,
        },
      ],
      { counter: 0, newestSampleMs: 0 },
    );

    const archived = await store.compactEnergy(NOW_MS);

    expect(archived).toBe(1);
    expect(await store.readMinutes(OLD_YEAR_MINUTE, OLD_YEAR_MINUTE)).toEqual([]);
    expect(await store.readMinutes(CURRENT_YEAR_MINUTE, CURRENT_YEAR_MINUTE)).toHaveLength(1);
    const months = await store.readMonths();
    expect(months).toHaveLength(1);
    expect(months[0].wattSeconds).toBe(120);
  });
});
