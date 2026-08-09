// The cursor's whole job: a sample counts once, no matter how many times the
// window that holds it is drained. These exercise that against the in-memory
// store — the atomic-commit-under-teardown half is proven in a real service
// worker (see the browser test), which this deliberately does not stand in for.

import { describe, expect, it } from "vitest";
import { decodeHistoryWindow, type TelemetrySample } from "@core/telemetry";
import type { DishWindow } from "@core/drain";
import type { DishHistoryJson } from "@core/dishClient";
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

/** A dish history ring of `length` one-second slots reporting since-boot counter
 *  `current` — the shape decodeHistoryWindow unrolls, so its samples get the same
 *  wall-clock stamping (anchored to the decode's nowMs) a live drain produces. */
function ring(current: number, length: number): DishHistoryJson {
  const filled = (value: number) => Array.from({ length }, () => value);
  return {
    current,
    popPingLatencyMs: filled(20),
    popPingDropRate: filled(0),
    downlinkThroughputBps: filled(0),
    uplinkThroughputBps: filled(0),
    powerIn: filled(10),
  } as DishHistoryJson;
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

  // The raw-sample store must hold true 1 Hz — not a copy of every overlapping
  // sample per drain. decodeHistoryWindow stamps from each drain's nowMs, so a
  // re-drained slot re-decodes to a different timestamp; stored whole it would land
  // under a new key instead of overwriting, and the store would grow ~30x — far
  // enough to push /api/samples past the service worker's 64 MiB message cap.
  it("stores each raw sample once across overlapping drains, not once per re-drain", async () => {
    const store = new InMemoryHistory();
    const RING = 900; // a ~15-minute dish ring, re-read whole on every drain

    // A drain decodes the ring at its own wall clock; the next, ~30s later, is not
    // a whole second on from it, so the overlapping slots re-decode to new stamps.
    const nowA = 1_785_000_000_000 + 137;
    await applyDrain(store, decodeHistoryWindow(ring(1_000, RING), nowA), nowA);

    const nowB = nowA + 30_200; // the .2s of drift is what defeats the timestamp dedup
    await applyDrain(store, decodeHistoryWindow(ring(1_030, RING), nowB), nowB);

    // First drain seeded the whole ring; the second advanced the counter by 30, so
    // only its 30 newest samples are new. The 870-sample overlap must not re-store.
    const stored = await store.readSamples(360, nowB);
    expect(stored.length).toBe(RING + 30);
  });
});

describe("compactEnergy", () => {
  const EMPTY_CURSOR = { counter: 0, newestSampleMs: 0 };
  // Both offsets are wide enough (years, not days) that neither can cross a
  // calendar-year boundary the other way regardless of the machine's timezone.
  const NOW_MS = Date.now();
  const CURRENT_YEAR_MINUTE = Math.floor(NOW_MS / 1000 / 60) * 60;
  const OLD_YEAR_MINUTE = CURRENT_YEAR_MINUTE - 3 * 365 * 24 * 3_600;

  it("folds minutes from a past year into a month row and drops them from the minute store", async () => {
    const store = new InMemoryHistory();
    await store.commit(
      [
        {
          minute: OLD_YEAR_MINUTE,
          wattSeconds: 120,
          samples: 60,
          downlinkBits: 8e6,
          uplinkBits: 1e6,
        },
      ],
      EMPTY_CURSOR,
    );

    const archived = await store.compactEnergy(NOW_MS);

    expect(archived).toBe(1);
    expect(await store.readMinutes(OLD_YEAR_MINUTE, OLD_YEAR_MINUTE)).toEqual([]);
    const months = await store.readMonths();
    expect(months).toHaveLength(1);
    expect(months[0].wattSeconds).toBe(120);
    expect(months[0].downlinkBits).toBe(8e6);
    expect(months[0].uplinkBits).toBe(1e6);
  });

  it("leaves minutes from the current year alone", async () => {
    const store = new InMemoryHistory();
    await store.commit(
      [
        {
          minute: CURRENT_YEAR_MINUTE,
          wattSeconds: 50,
          samples: 60,
          downlinkBits: 0,
          uplinkBits: 0,
        },
      ],
      EMPTY_CURSOR,
    );

    const archived = await store.compactEnergy(NOW_MS);

    expect(archived).toBe(0);
    expect(await store.readMinutes(CURRENT_YEAR_MINUTE, CURRENT_YEAR_MINUTE)).toHaveLength(1);
    expect(await store.readMonths()).toEqual([]);
  });

  it("running it again after everything is already archived is a no-op", async () => {
    const store = new InMemoryHistory();
    await store.commit(
      [
        {
          minute: OLD_YEAR_MINUTE,
          wattSeconds: 120,
          samples: 60,
          downlinkBits: 8e6,
          uplinkBits: 1e6,
        },
      ],
      EMPTY_CURSOR,
    );
    await store.compactEnergy(NOW_MS);

    const secondPass = await store.compactEnergy(NOW_MS);

    expect(secondPass).toBe(0);
    expect(await store.readMonths()).toHaveLength(1);
  });

  it("adds onto an already-archived month rather than overwriting it, for a late-arriving old minute", async () => {
    const store = new InMemoryHistory();
    await store.commit(
      [{ minute: OLD_YEAR_MINUTE, wattSeconds: 100, samples: 60, downlinkBits: 0, uplinkBits: 0 }],
      EMPTY_CURSOR,
    );
    await store.compactEnergy(NOW_MS);
    // A second old minute in the same archived month, arriving after that
    // month's row already exists (a backfill, or a very late drain).
    await store.commit(
      [
        {
          minute: OLD_YEAR_MINUTE + 60,
          wattSeconds: 25,
          samples: 60,
          downlinkBits: 0,
          uplinkBits: 0,
        },
      ],
      EMPTY_CURSOR,
    );

    await store.compactEnergy(NOW_MS);

    const months = await store.readMonths();
    expect(months).toHaveLength(1);
    expect(months[0].wattSeconds).toBe(125);
    expect(months[0].samples).toBe(120);
  });
});
