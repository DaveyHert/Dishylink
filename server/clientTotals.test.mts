// The odometer's whole job is to turn the router's per-association byte counter —
// which resets every time a device reconnects — into a real monthly total. What
// is asserted here is exactly the arithmetic that makes that true: a normal
// delta, a reset added whole, an unobserved gap skipped, and the month rolling
// over without leaking one month's traffic into the next.

import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientTotalsStore } from "./clientTotals.mts";

const MAC = "aa:bb:cc:dd:ee:ff";
const paths: string[] = [];
function tempStore(): ClientTotalsStore {
  const path = join(tmpdir(), `client-totals-${Math.random().toString(36).slice(2)}.json`);
  paths.push(path);
  return new ClientTotalsStore(path);
}
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

// A fixed mid-month instant, so nothing here straddles a real month boundary.
const T0 = new Date(2026, 6, 10, 12, 0, 0).getTime(); // 10 Jul 2026, local

describe("ClientTotalsStore.observe", () => {
  it("sums forward counter deltas, ignoring the first (baseline) reading", () => {
    const store = tempStore();
    store.observe(MAC, 1_000, 100, T0); // baseline, adds nothing
    store.observe(MAC, 1_500, 180, T0 + 1_000); // +500 / +80
    store.observe(MAC, 2_000, 200, T0 + 2_000); // +500 / +20
    const [total] = store.totals(MAC);
    expect(total.rxBytes).toBe(1_000);
    expect(total.txBytes).toBe(100);
  });

  it("counts a counter that reset as new traffic, not negative", () => {
    const store = tempStore();
    store.observe(MAC, 1_000, 500, T0); // baseline
    store.observe(MAC, 5_000, 900, T0 + 1_000); // +4000 / +400
    // Device reconnected: counter restarts low. The 300 is fresh traffic.
    store.observe(MAC, 300, 20, T0 + 2_000); // +300 / +20 (added whole)
    const [total] = store.totals(MAC);
    expect(total.rxBytes).toBe(4_300);
    expect(total.txBytes).toBe(420);
  });

  it("skips a gap too wide to have observed, rather than inventing the span", () => {
    const store = tempStore();
    store.observe(MAC, 1_000, 0, T0); // baseline
    store.observe(MAC, 2_000, 0, T0 + 1_000); // +1000
    // 20s later — beyond the 15s ceiling. The 9000-byte jump spans traffic we did
    // not watch (a paused laptop), so it re-baselines and adds nothing.
    store.observe(MAC, 11_000, 0, T0 + 21_000);
    store.observe(MAC, 11_500, 0, T0 + 22_000); // +500, counting resumes
    const [total] = store.totals(MAC);
    expect(total.rxBytes).toBe(1_500);
  });

  it("starts a fresh bucket at the month boundary without carrying traffic over", () => {
    const store = tempStore();
    store.observe(MAC, 1_000, 0, T0); // baseline, July
    store.observe(MAC, 4_000, 0, T0 + 1_000); // +3000, July total
    expect(store.totals(MAC)[0].rxBytes).toBe(3_000);

    const aug = new Date(2026, 7, 1, 0, 0, 5).getTime(); // 1 Aug 2026
    store.observe(MAC, 4_500, 0, aug); // new month → reset, no carry-over
    store.observe(MAC, 5_000, 0, aug + 1_000); // +500, August total
    const [total] = store.totals(MAC);
    expect(total.rxBytes).toBe(500);
    expect(total.sinceMs).toBe(new Date(2026, 7, 1, 0, 0, 0).getTime());
  });
});

describe("ClientTotalsStore seed / remove / clear / compact / persistence", () => {
  it("seeds an opening total but does not double-count the first live reading", () => {
    const store = tempStore();
    store.seed(MAC, 7_000_000_000, 1_000_000_000, T0, "MacBook");
    // First real poll is a baseline against the current counter, not a delta from 0.
    store.observe(MAC, 820_000_000, 120_000_000, T0 + 1_000, "MacBook");
    store.observe(MAC, 820_500_000, 120_100_000, T0 + 2_000); // +500k / +100k
    const [total] = store.totals(MAC);
    expect(total.rxBytes).toBe(7_000_500_000);
    expect(total.txBytes).toBe(1_000_100_000);
    expect(total.name).toBe("MacBook");
  });

  // The historian seeds from recorded history, most of which belongs to devices
  // that are offline by the time it runs, so the instant it passes is the one the
  // list reports as last-seen. Stamping "now" would show them all as active.
  it("seeds last-seen at the instant given, not the current time", () => {
    const store = tempStore();
    const lastSeen = T0 - 4 * 3_600_000; // recorded four hours ago
    store.seed(MAC, 1_000, 100, lastSeen, "MacBook");
    const [total] = store.totals(MAC);
    expect(total.lastSeenMs).toBe(lastSeen);
    // Still filed under the month that instant falls in.
    expect(total.sinceMs).toBe(new Date(2026, 6, 1).getTime());
  });

  it("seed is a no-op once a device already has a total", () => {
    const store = tempStore();
    store.observe(MAC, 0, 0, T0);
    store.observe(MAC, 1_000, 0, T0 + 1_000);
    store.seed(MAC, 9_999, 9_999, T0); // ignored
    expect(store.totals(MAC)[0].rxBytes).toBe(1_000);
  });

  it("reset zeros the total but keeps the entry counting forward from the current counter", () => {
    const store = tempStore();
    store.observe(MAC, 1_000, 0, T0); // baseline
    store.observe(MAC, 6_000, 0, T0 + 1_000); // +5000
    expect(store.totals(MAC)[0].rxBytes).toBe(5_000);
    expect(store.reset(MAC, T0 + 1_500)).toBe(true);
    expect(store.totals(MAC)[0].rxBytes).toBe(0);
    expect(store.totals(MAC)[0].sinceMs).toBe(T0 + 1_500);
    // Next reading is a normal delta against the live counter, not a jump back to 6000.
    store.observe(MAC, 6_400, 0, T0 + 2_000); // +400
    expect(store.totals(MAC)[0].rxBytes).toBe(400);
  });

  it("reset returns false for a device it has never seen", () => {
    expect(tempStore().reset("nope", T0)).toBe(false);
  });

  it("remove deletes one device; an active device simply recounts next poll", () => {
    const store = tempStore();
    store.observe(MAC, 0, 0, T0);
    store.observe(MAC, 5_000, 0, T0 + 1_000);
    expect(store.remove(MAC)).toBe(true);
    expect(store.totals(MAC)).toHaveLength(0);
    store.observe(MAC, 6_000, 0, T0 + 2_000); // baseline again
    store.observe(MAC, 6_400, 0, T0 + 3_000); // +400
    expect(store.totals(MAC)[0].rxBytes).toBe(400);
  });

  it("compact drops devices unseen since before last month, keeps recent ones", () => {
    const store = tempStore();
    const old = new Date(2026, 4, 20).getTime(); // May — two months before July
    store.observe("old:mac", 0, 0, old);
    store.observe(MAC, 0, 0, T0);
    const dropped = store.compact(T0);
    expect(dropped).toBe(1);
    expect(store.totals("old:mac")).toHaveLength(0);
    expect(store.totals(MAC)).toHaveLength(1);
  });

  it("survives a restart by reloading the snapshot", () => {
    const path = join(tmpdir(), `client-totals-${Math.random().toString(36).slice(2)}.json`);
    paths.push(path);
    const first = new ClientTotalsStore(path);
    first.observe(MAC, 0, 0, T0);
    first.observe(MAC, 3_000, 400, T0 + 1_000);
    first.snapshot();
    const reopened = new ClientTotalsStore(path);
    expect(reopened.totals(MAC)[0].rxBytes).toBe(3_000);
    expect(reopened.totals(MAC)[0].txBytes).toBe(400);
  });
});
