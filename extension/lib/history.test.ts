// The cursor's whole job: a sample counts once, no matter how many times the
// window that holds it is drained. These exercise that against the in-memory
// store — the atomic-commit-under-teardown half is proven in a real service
// worker (see the browser test), which this deliberately does not stand in for.

import { describe, expect, it } from "vitest";
import type { TelemetrySample } from "@core/telemetry";
import type { DishWindow } from "@core/drain";
import { applyDrain, InMemoryHistory } from "./history";

const MINUTE = 1_785_000_000; // an arbitrary minute start, epoch seconds

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

/** A window of `count` one-second samples, each drawing `powerW`. */
function window(count: number, powerW: number): DishWindow {
  const samples = Array.from({ length: count }, (_, second) => sample(second, powerW));
  return { samples, newestCounter: count };
}

async function totalWattSeconds(store: InMemoryHistory): Promise<number> {
  const buckets = await store.readMinutes(MINUTE, MINUTE);
  return buckets.reduce((sum, bucket) => sum + bucket.wattSeconds, 0);
}

describe("applyDrain / cursor", () => {
  it("records a window's energy on the first drain", async () => {
    const store = new InMemoryHistory();
    await applyDrain(store, window(60, 10));
    expect(await totalWattSeconds(store)).toBe(600);
    const [bucket] = await store.readMinutes(MINUTE, MINUTE);
    expect(bucket.samples).toBe(60);
  });

  it("adds nothing when the same window is drained again", async () => {
    const store = new InMemoryHistory();
    const w = window(60, 10);
    await applyDrain(store, w);
    await applyDrain(store, w); // same samples, cursor already past them
    expect(await totalWattSeconds(store)).toBe(600);
    const [bucket] = await store.readMinutes(MINUTE, MINUTE);
    expect(bucket.samples).toBe(60);
  });

  it("totals a minute split across two wakes without double-counting", async () => {
    const store = new InMemoryHistory();
    // First wake sees the first 30 seconds of the minute...
    await applyDrain(store, { samples: window(30, 10).samples, newestCounter: 30 });
    // ...the second wake sees the whole minute; only seconds 30–59 are new.
    await applyDrain(store, { samples: window(60, 10).samples, newestCounter: 60 });
    const [bucket] = await store.readMinutes(MINUTE, MINUTE);
    expect(bucket.samples).toBe(60);
    expect(bucket.wattSeconds).toBe(600);
  });

  it("re-reading an unchanged window after a wake with no new samples is a no-op", async () => {
    const store = new InMemoryHistory();
    await applyDrain(store, window(45, 8));
    const before = await totalWattSeconds(store);
    await applyDrain(store, window(45, 8));
    await applyDrain(store, window(45, 8));
    expect(await totalWattSeconds(store)).toBe(before);
  });
});
