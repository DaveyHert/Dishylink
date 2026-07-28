// The odometer's whole job is to turn the router's per-association byte counter —
// which resets every time a device reconnects — into a real monthly total, keyed
// by the router's clientId. What is asserted here is that arithmetic (a normal
// delta, a reset added whole, an unobserved gap skipped, a clean month roll) plus
// the two things clientId keying buys: two devices behind one vendor-masked MAC
// stay separate, and a device whose clientId is reissued by a factory reset
// re-anchors to its old total when its MAC is unique, or starts fresh when it is
// shared by a same-vendor group.

import { afterEach, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientTotalsStore } from "./clientTotals.mts";

const MAC = "aa:bb:cc:dd:ee:ff";
const A = 111;
const paths: string[] = [];
function tempPath(): string {
  const path = join(tmpdir(), `client-totals-${Math.random().toString(36).slice(2)}.json`);
  paths.push(path);
  return path;
}
function tempStore(): ClientTotalsStore {
  return new ClientTotalsStore(tempPath());
}
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

/** A live-key set from clientIds. */
function live(...ids: number[]): Set<string> {
  return new Set(ids.map(String));
}

// A fixed mid-month instant, so nothing here straddles a real month boundary.
const T0 = new Date(2026, 6, 10, 12, 0, 0).getTime(); // 10 Jul 2026, local

describe("ClientTotalsStore.observe arithmetic (single device)", () => {
  // One device, one clientId. Adoption never fires (the key is found or brand
  // new), so this isolates the delta arithmetic.
  const obs = (store: ClientTotalsStore, rx: number, tx: number, at: number, name?: string) =>
    store.observe(A, MAC, rx, tx, at, name, live(A));
  const rx = (store: ClientTotalsStore) => store.totals(String(A))[0].rxBytes;

  it("sums forward counter deltas, ignoring the first (baseline) reading", () => {
    const store = tempStore();
    obs(store, 1_000, 100, T0); // baseline, adds nothing
    obs(store, 1_500, 180, T0 + 1_000); // +500 / +80
    obs(store, 2_000, 200, T0 + 2_000); // +500 / +20
    const [total] = store.totals(String(A));
    expect(total.rxBytes).toBe(1_000);
    expect(total.txBytes).toBe(100);
  });

  it("counts a counter that reset as new traffic, not negative", () => {
    const store = tempStore();
    obs(store, 1_000, 500, T0); // baseline
    obs(store, 5_000, 900, T0 + 1_000); // +4000 / +400
    obs(store, 300, 20, T0 + 2_000); // reconnect: counter low, 300/20 added whole
    const [total] = store.totals(String(A));
    expect(total.rxBytes).toBe(4_300);
    expect(total.txBytes).toBe(420);
  });

  it("skips a gap too wide to have observed, rather than inventing the span", () => {
    const store = tempStore();
    obs(store, 1_000, 0, T0); // baseline
    obs(store, 2_000, 0, T0 + 1_000); // +1000
    obs(store, 11_000, 0, T0 + 21_000); // 20s gap > 15s ceiling → re-baseline, no add
    obs(store, 11_500, 0, T0 + 22_000); // +500, counting resumes
    expect(rx(store)).toBe(1_500);
  });

  it("starts a fresh bucket at the month boundary without carrying traffic over", () => {
    const store = tempStore();
    obs(store, 1_000, 0, T0); // baseline, July
    obs(store, 4_000, 0, T0 + 1_000); // +3000 July
    expect(rx(store)).toBe(3_000);
    const aug = new Date(2026, 7, 1, 0, 0, 5).getTime();
    obs(store, 4_500, 0, aug); // new month → reset, no carry-over
    obs(store, 5_000, 0, aug + 1_000); // +500 August
    const [total] = store.totals(String(A));
    expect(total.rxBytes).toBe(500);
    expect(total.sinceMs).toBe(new Date(2026, 7, 1, 0, 0, 0).getTime());
  });
});

// The Starlink router masks every client MAC to its vendor OUI over the LAN, so
// four Govee lights arrive with the same MAC string. clientId is the only field
// that tells them apart, so each must get its own total — a MAC key would merge
// them (the bug this replaced: a 758 GB "upload" from an LED strip).
describe("ClientTotalsStore.observe with same-MAC devices", () => {
  it("keeps two devices on one masked MAC as separate totals", () => {
    const store = tempStore();
    const lk = store.notePoll([
      { clientId: 1, macAddress: MAC },
      { clientId: 2, macAddress: MAC },
    ]);
    store.observe(1, MAC, 1_000, 0, T0, "Govee A", lk);
    store.observe(2, MAC, 5_000, 0, T0, "Govee B", lk);
    store.observe(1, MAC, 1_500, 0, T0 + 1_000, "Govee A", lk); // A +500
    store.observe(2, MAC, 5_200, 0, T0 + 1_000, "Govee B", lk); // B +200
    expect(store.totals("1")[0].rxBytes).toBe(500);
    expect(store.totals("2")[0].rxBytes).toBe(200);
    expect(store.totals()).toHaveLength(2);
  });

  it("deltas each device against its own counter, never its sibling's", () => {
    const store = tempStore();
    const lk = store.notePoll([
      { clientId: 1, macAddress: MAC },
      { clientId: 2, macAddress: MAC },
    ]);
    store.observe(1, MAC, 9_000, 0, T0, "Govee A", lk);
    store.observe(2, MAC, 4_000, 0, T0, "Govee B", lk);
    store.observe(2, MAC, 250, 0, T0 + 1_000, "Govee B", lk); // B reconnect: +250 whole
    store.observe(1, MAC, 9_100, 0, T0 + 1_000, "Govee A", lk); // A +100 (unaffected by B)
    expect(store.totals("2")[0].rxBytes).toBe(250);
    expect(store.totals("1")[0].rxBytes).toBe(100);
  });
});

// A factory reset reissues clientIds but not the (masked) MAC. A device whose MAC
// is its own re-anchors to its old total; a same-vendor group cannot and starts
// fresh — the user's chosen, and only possible, behaviour.
// Decides who inherits throughput rows recorded before per-device keying. The
// stake is continuity: a device the MAC masking never affected must not see its
// chart break at the moment the fix shipped, and a vendor group must not each
// inherit a row that was the whole group's traffic summed.
describe("ClientTotalsStore.resolveLegacyMac", () => {
  it("gives the rows to the one device wearing an unshared MAC", () => {
    const store = tempStore();
    store.observe(A, MAC, 1_000, 0, T0, "MacBook", live(A));
    expect(store.resolveLegacyMac(MAC)).toBe(String(A));
  });

  it("gives them to nobody once the MAC is known to have carried a group", () => {
    const store = tempStore();
    const lk = store.notePoll([
      { clientId: 101, macAddress: MAC },
      { clientId: 102, macAddress: MAC },
    ]);
    store.observe(101, MAC, 1_000, 0, T0, "bulb A", lk);
    store.observe(102, MAC, 1_000, 0, T0, "bulb B", lk);
    expect(store.resolveLegacyMac(MAC)).toBeUndefined();
  });

  // The regression this guards: a device seen both before and after adoption has
  // a keyed bucket AND a leftover un-keyed one. Counting the pair as "more than
  // one device" would strip an unshared device of its own history.
  it("ignores un-keyed buckets rather than counting them as a second device", () => {
    const store = tempStore();
    store.seed(MAC, 5_000, 100, T0, "MacBook"); // legacy bucket, no clientId
    store.observe(A, MAC, 1_000, 0, T0 + 1_000, "MacBook", live(A));
    expect(store.resolveLegacyMac(MAC)).toBe(String(A));
  });

  it("gives them to nobody when only an un-keyed bucket wears the MAC", () => {
    const store = tempStore();
    store.seed(MAC, 5_000, 100, T0, "offline device");
    expect(store.resolveLegacyMac(MAC)).toBeUndefined();
  });

  it("gives them to nobody on a MAC it has never seen", () => {
    expect(tempStore().resolveLegacyMac(MAC)).toBeUndefined();
  });
});

describe("ClientTotalsStore adoption across a clientId reissue", () => {
  it("re-anchors an unknown clientId to the orphan when the MAC is unique", () => {
    const store = tempStore();
    store.observe(111, MAC, 1_000, 0, T0, "iPhone", live(111));
    store.observe(111, MAC, 6_000, 0, T0 + 1_000, "iPhone", live(111)); // +5000
    expect(store.totals("111")[0].rxBytes).toBe(5_000);
    // Reset: same device returns as clientId 222 on the same unique MAC.
    const lk = store.notePoll([{ clientId: 222, macAddress: MAC }]);
    store.observe(222, MAC, 40, 0, T0 + 2_000, "iPhone", lk); // adoption reading adds 0
    expect(store.totals("111")).toHaveLength(0); // old key re-keyed away
    expect(store.totals("222")[0].rxBytes).toBe(5_000); // continued, not reset
    store.observe(222, MAC, 90, 0, T0 + 3_000, "iPhone", live(222)); // +50
    expect(store.totals("222")[0].rxBytes).toBe(5_050);
  });

  it("adopts once: the next poll finds the new key directly and does not re-adopt", () => {
    const store = tempStore();
    store.observe(111, MAC, 0, 0, T0, "iPhone", live(111));
    store.observe(111, MAC, 1_000, 0, T0 + 1_000, "iPhone", live(111)); // +1000
    store.observe(
      222,
      MAC,
      500,
      0,
      T0 + 2_000,
      "iPhone",
      store.notePoll([{ clientId: 222, macAddress: MAC }]),
    ); // adopt
    // A stray reappearance of the old id must NOT re-adopt 222's now-live bucket.
    store.observe(111, MAC, 12_345, 0, T0 + 3_000, "iPhone", live(111, 222));
    expect(store.totals("222")[0].rxBytes).toBe(1_000);
    expect(store.totals("111")[0].rxBytes).toBe(0); // a genuinely fresh, separate bucket
  });

  it("does not re-anchor on a shared OUI — the group starts fresh after a reset", () => {
    const store = tempStore();
    let lk = store.notePoll([
      { clientId: 1, macAddress: MAC },
      { clientId: 2, macAddress: MAC },
    ]);
    store.observe(1, MAC, 1_000, 0, T0, "Govee A", lk);
    store.observe(1, MAC, 1_400, 0, T0 + 1_000, "Govee A", lk); // +400
    store.observe(2, MAC, 500, 0, T0, "Govee B", lk);
    expect(store.totals("1")[0].rxBytes).toBe(400);
    // Reset: new ids, MAC still flagged shared (persisted) → no adoption.
    lk = store.notePoll([{ clientId: 3, macAddress: MAC }]);
    store.observe(3, MAC, 50, 0, T0 + 2_000, "Govee A", lk);
    expect(store.totals("3")[0].rxBytes).toBe(0); // fresh, not the old 400
  });

  it("drops a legacy merged bucket when its OUI is first seen shared", () => {
    const store = tempStore();
    store.seed(MAC, 9_000, 0, T0, "Govee (merged)"); // legacy, clientId undefined
    const lk = store.notePoll([
      { clientId: 1, macAddress: MAC },
      { clientId: 2, macAddress: MAC },
    ]);
    store.observe(1, MAC, 100, 0, T0, "Govee A", lk);
    store.observe(2, MAC, 200, 0, T0, "Govee B", lk);
    expect(
      store
        .totals()
        .map((total) => total.clientId)
        .sort(),
    ).toEqual([1, 2]); // the merged bucket is gone
  });

  it("adopts the legacy bucket for a lone device on a never-shared OUI", () => {
    const store = tempStore();
    store.seed(MAC, 9_000, 0, T0, "iPhone"); // seeded from history, no clientId yet
    const lk = store.notePoll([{ clientId: 111, macAddress: MAC }]);
    store.observe(111, MAC, 3, 0, T0, "iPhone", lk); // adopts the seeded total, adds 0
    expect(store.totals("111")[0].rxBytes).toBe(9_000);
  });
});

describe("ClientTotalsStore seed / reset / remove / compact / persistence", () => {
  it("seeds an opening total but does not double-count the first live reading", () => {
    const store = tempStore();
    store.seed(MAC, 7_000_000_000, 1_000_000_000, T0, "MacBook");
    const lk = store.notePoll([{ clientId: A, macAddress: MAC }]);
    store.observe(A, MAC, 820_000_000, 120_000_000, T0 + 1_000, "MacBook", lk); // adopts, baseline
    store.observe(A, MAC, 820_500_000, 120_100_000, T0 + 2_000, "MacBook", live(A)); // +500k/+100k
    const [total] = store.totals(String(A));
    expect(total.rxBytes).toBe(7_000_500_000);
    expect(total.txBytes).toBe(1_000_100_000);
    expect(total.name).toBe("MacBook");
  });

  it("seeds last-seen at the instant given, not the current time", () => {
    const store = tempStore();
    const lastSeen = T0 - 4 * 3_600_000;
    store.seed(MAC, 1_000, 100, lastSeen, "MacBook");
    const [total] = store.totals(MAC); // legacy bucket still keyed by MAC until adopted
    expect(total.lastSeenMs).toBe(lastSeen);
    expect(total.sinceMs).toBe(new Date(2026, 6, 1).getTime());
  });

  it("seed is a no-op once any bucket already covers the MAC (double-count guard)", () => {
    const store = tempStore();
    const lk = store.notePoll([{ clientId: A, macAddress: MAC }]);
    store.observe(A, MAC, 0, 0, T0, "A", lk);
    store.observe(A, MAC, 1_000, 0, T0 + 1_000, "A", live(A)); // +1000, clientId-keyed
    expect(store.seed(MAC, 9_999, 9_999, T0, "A")).toBe(false); // MAC already covered
    expect(store.totals(String(A))[0].rxBytes).toBe(1_000);
    expect(store.totals()).toHaveLength(1);
  });

  it("reset zeros the total but keeps it counting forward, keyed by clientId", () => {
    const store = tempStore();
    store.observe(A, MAC, 1_000, 0, T0, "A", live(A)); // baseline
    store.observe(A, MAC, 6_000, 0, T0 + 1_000, "A", live(A)); // +5000
    expect(store.reset(String(A), T0 + 1_500)).toBe(true);
    expect(store.totals(String(A))[0].rxBytes).toBe(0);
    expect(store.totals(String(A))[0].sinceMs).toBe(T0 + 1_500);
    store.observe(A, MAC, 6_400, 0, T0 + 2_000, "A", live(A)); // +400 against live counter
    expect(store.totals(String(A))[0].rxBytes).toBe(400);
  });

  it("reset returns false for a device it has never seen", () => {
    expect(tempStore().reset("nope", T0)).toBe(false);
  });

  it("remove deletes one device by clientId; an active one recounts next poll", () => {
    const store = tempStore();
    store.observe(A, MAC, 0, 0, T0, "A", live(A));
    store.observe(A, MAC, 5_000, 0, T0 + 1_000, "A", live(A));
    expect(store.remove(String(A))).toBe(true);
    expect(store.totals(String(A))).toHaveLength(0);
  });

  it("compact drops devices unseen since before last month, keeps recent ones", () => {
    const store = tempStore();
    const old = new Date(2026, 4, 20).getTime(); // May — two months before July
    store.observe(999, "old:mac", 0, 0, old, "old", live(999));
    store.observe(A, MAC, 0, 0, T0, "A", live(A));
    expect(store.compact(T0)).toBe(1);
    expect(store.totals("999")).toHaveLength(0);
    expect(store.totals(String(A))).toHaveLength(1);
  });

  it("survives a restart, reloading per-device totals and the shared-OUI flags", () => {
    const path = tempPath();
    const first = new ClientTotalsStore(path);
    const lk = first.notePoll([
      { clientId: 1, macAddress: MAC },
      { clientId: 2, macAddress: MAC },
    ]);
    first.observe(1, MAC, 0, 0, T0, "A", lk);
    first.observe(1, MAC, 300, 0, T0 + 1_000, "A", lk); // A +300
    first.observe(2, MAC, 0, 0, T0, "B", lk);
    first.observe(2, MAC, 100, 0, T0 + 1_000, "B", lk); // B +100
    first.snapshot();

    const reopened = new ClientTotalsStore(path);
    expect(reopened.totals("1")[0].rxBytes).toBe(300);
    expect(reopened.totals("2")[0].rxBytes).toBe(100);
    // Shared flag survived: a new clientId on this OUI must NOT adopt.
    const lk2 = reopened.notePoll([{ clientId: 9, macAddress: MAC }]);
    reopened.observe(9, MAC, 50, 0, T0 + 2_000, "A", lk2);
    expect(reopened.totals("9")[0].rxBytes).toBe(0);
  });

  it("carries the counter baseline across a restart, so a fast one loses no delta", () => {
    const path = tempPath();
    const first = new ClientTotalsStore(path);
    first.observe(A, MAC, 1_000, 0, T0, "A", live(A)); // baseline
    first.snapshot();
    const reopened = new ClientTotalsStore(path);
    reopened.observe(A, MAC, 1_200, 0, T0 + 2_000, "A", live(A)); // within gap → +200
    expect(reopened.totals(String(A))[0].rxBytes).toBe(200);
  });

  it("starts fresh on a snapshot whose version it does not recognise", () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({ version: 2, totals: [{ macAddress: MAC }], sharedMacs: [] }),
    );
    expect(new ClientTotalsStore(path).totals()).toEqual([]);
  });
});
