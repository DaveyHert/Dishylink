// The odometer's whole job is to turn the router's per-association byte counter —
// which resets every time a device reconnects — into a real monthly total, keyed
// by the router's clientId. What is asserted here is that arithmetic (a normal
// delta, a reset added whole, an unobserved gap skipped, a clean month roll) plus
// the two things clientId keying buys: two devices behind one vendor-masked MAC
// stay separate, and a device whose clientId is reissued by a factory reset
// re-anchors to its old total when its MAC is unique, or starts fresh when it is
// shared by a same-vendor group.

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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

  // A device that sleeps or roams re-associates constantly, and the router
  // restarts its counter each time. Billing every restart as a fresh counter's
  // worth is what took a laptop whose counter reads under a gigabyte to a
  // recorded terabyte in a fortnight.
  it("ignores a restart claiming more traffic than the interval could carry", () => {
    const store = tempStore();
    obs(store, 1_000, 0, T0); // baseline
    obs(store, 900_000_000, 0, T0 + 200); // +899999000, a plausible 200ms burst
    // Backwards, and 800 MB is far past what 200ms of a 2.5 Gbps link holds:
    // a stale reply repeating a counter already counted, not 800 MB of traffic.
    obs(store, 800_000_000, 0, T0 + 400);
    expect(rx(store)).toBe(899_999_000);
  });

  it("still counts a restart small enough to have happened in the interval", () => {
    const store = tempStore();
    obs(store, 900_000_000, 0, T0); // baseline
    obs(store, 5_000, 0, T0 + 200); // genuine reconnect: counter restarted low
    expect(rx(store)).toBe(5_000);
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

  it("compact drops devices unseen for longer than the history window", () => {
    const store = tempStore();
    const gone = new Date(2025, 11, 20).getTime(); // Dec 2025 — beyond six months
    const away = new Date(2026, 4, 20).getTime(); // May — inside the window
    store.observe(999, "old:mac", 0, 0, gone, "old", live(999));
    store.observe(998, "away:mac", 0, 0, away, "away", live(998));
    store.observe(A, MAC, 0, 0, T0, "A", live(A));
    expect(store.compact(T0)).toBe(1);
    expect(store.totals("999")).toHaveLength(0);
    // A device seen within the window keeps its record, and the months with it.
    expect(store.totals("998")).toHaveLength(1);
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

  it("files each month as it rolls, keeping the last six", () => {
    const store = tempStore();
    // Ten months, each moving 1000 more bytes than the last.
    for (let month = 0; month < 10; month++) {
      const at = new Date(2026, month, 10, 12).getTime();
      store.observe(A, MAC, 0, 0, at, "A", live(A));
      store.observe(A, MAC, (month + 1) * 1_000, 0, at + 1_000, "A", live(A));
    }
    const [total] = store.totals(String(A));
    expect(total.months).toHaveLength(6);
    // Oldest first, and the earliest four have aged out.
    expect(total.months!.map((m) => m.rxBytes)).toEqual([4_000, 5_000, 6_000, 7_000, 8_000, 9_000]);
    expect(total.rxBytes).toBe(10_000); // the month still running
  });

  it("does not file a month a device passed no traffic in", () => {
    const store = tempStore();
    const july = new Date(2026, 6, 10, 12).getTime();
    store.observe(A, MAC, 0, 0, july, "A", live(A));
    store.observe(A, MAC, 500, 0, july + 1_000, "A", live(A));
    // Away for August and September, back in October: only July is on record.
    const october = new Date(2026, 9, 10, 12).getTime();
    store.observe(A, MAC, 500, 0, october, "A", live(A));
    const [total] = store.totals(String(A));
    expect(total.months).toEqual([{ periodMonth: 2026 * 12 + 6, rxBytes: 500, txBytes: 0 }]);
  });

  it("adds the months of two identities merged into one device", () => {
    const store = tempStore();
    const july = new Date(2026, 6, 10, 12).getTime();
    const august = new Date(2026, 7, 10, 12).getTime();
    for (const id of [1, 2]) {
      store.observe(id, `m${id}:mac`, 0, 0, july, "same", live(1, 2));
      store.observe(id, `m${id}:mac`, id * 1_000, 0, july + 1_000, "same", live(1, 2));
      store.observe(id, `m${id}:mac`, id * 1_000, 0, august, "same", live(1, 2));
    }
    expect(store.merge("1", "2")).toBe(true);
    const [total] = store.totals("2");
    expect(total.months).toEqual([{ periodMonth: 2026 * 12 + 6, rxBytes: 3_000, txBytes: 0 }]);
  });

  it("keeps the figure a snapshot from before the lifetime counter was showing", () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 3,
        totals: [
          {
            clientId: A,
            macAddress: MAC,
            name: "A",
            rxBytes: 4_000,
            txBytes: 900,
            sinceMs: T0,
            lastSeenMs: T0,
            periodMonth: 2026 * 12 + 6,
            prevRx: 10_000,
            prevTx: 2_000,
            lastPollMs: T0,
          },
        ],
        sharedMacs: [],
      }),
    );
    const store = new ClientTotalsStore(path);
    const [total] = store.totals(String(A));
    expect(total.rxBytes).toBe(4_000);
    expect(total.txBytes).toBe(900);
    // And the restored counters still delta against the next live reading.
    store.observe(A, MAC, 10_500, 2_050, T0 + 1_000, "A", live(A));
    expect(store.totals(String(A))[0].rxBytes).toBe(4_500);
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

// A device whose MAC changes gets a new clientId with it, so neither the key nor
// the MAC re-anchor can carry its total over — the two buckets have to be joined
// on evidence the router does not supply. These assert the join itself: which
// record survives, when bytes may be added, and that a key from before the merge
// still finds the device afterwards however many times it has been reissued.
describe("ClientTotalsStore.merge", () => {
  const OLD_MAC = "5a:c9:44:XX:XX:XX";
  const NEW_MAC = "ea:17:b5:XX:XX:XX";
  const OLD = 13011248;
  const NEW = 2806438232;

  /** Two buckets for one device, the way a private-MAC rotation leaves them:
   *  an idle bucket on the abandoned identity and a live one on the new. */
  function forked(path = tempPath()): ClientTotalsStore {
    const store = new ClientTotalsStore(path);
    const idle = T0 - 36 * 3_600_000; // seen a day and a half ago
    store.observe(OLD, OLD_MAC, 0, 0, idle, "MacBook Pro M1", live(OLD));
    store.observe(OLD, OLD_MAC, 542_000, 44_000, idle + 1_000, "MacBook Pro M1", live(OLD));
    store.observe(NEW, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(NEW));
    store.observe(NEW, NEW_MAC, 48_000, 3_000, T0 + 1_000, "MacBook Pro M1", live(NEW));
    return store;
  }

  it("folds the idle bucket into the live one, keeping the live identity and MAC", () => {
    const store = forked();
    expect(store.merge(String(OLD), String(NEW))).toBe(true);
    expect(store.totals(String(OLD))).toHaveLength(0);
    const [total] = store.totals(String(NEW));
    expect(total.rxBytes).toBe(542_000 + 48_000);
    expect(total.txBytes).toBe(44_000 + 3_000);
    expect(total.clientId).toBe(NEW);
    expect(total.macAddress).toBe(NEW_MAC);
  });

  it("folds a bucket left standing on an already-merged identity", () => {
    // Written the way a build that let the retired key mint a fresh bucket left
    // it: the survivor, the alias onto it, and an orphan back on the merged-away
    // key. Nothing reaches that state now, but a snapshot from before still holds
    // it, and the offer to merge keeps coming back until this folds.
    const path = tempPath();
    const store = forked(path);
    store.snapshot();
    const orphan = JSON.parse(readFileSync(path, "utf8")).totals.find(
      (total: { clientId: number }) => total.clientId === OLD,
    );
    store.merge(String(OLD), String(NEW));
    store.snapshot();
    const stranded = JSON.parse(readFileSync(path, "utf8"));
    stranded.totals.push(orphan);
    writeFileSync(path, JSON.stringify(stranded));

    const reloaded = new ClientTotalsStore(path);
    expect(reloaded.totals(String(OLD))).toHaveLength(1);
    expect(reloaded.merge(String(OLD), String(NEW))).toBe(true);
    expect(reloaded.totals(String(OLD))).toHaveLength(0);
    expect(reloaded.mergeCandidates(T0 + 4_000)).toEqual([]);
  });

  it("keeps a merged-away identity merged when the device reappears under it", () => {
    const store = forked();
    store.merge(String(OLD), String(NEW));
    store.observe(OLD, OLD_MAC, 600_000, 50_000, T0 + 2_000, "MacBook Pro M1", live(OLD));
    expect(store.totals(String(OLD))).toHaveLength(0);
    expect(store.mergeCandidates(T0 + 3_000)).toEqual([]);
  });

  it("re-baselines, so the reading after a merge adds nothing", () => {
    const store = forked();
    store.merge(String(OLD), String(NEW));
    const merged = store.totals(String(NEW))[0].rxBytes;
    // A counter well above the survivor's last reading: measured as a delta it
    // would add 900_000, but the poll after a merge may only re-baseline.
    store.observe(NEW, NEW_MAC, 948_000, 3_000, T0 + 2_000, "MacBook Pro M1", live(NEW));
    expect(store.totals(String(NEW))[0].rxBytes).toBe(merged);
    // The one after it deltas normally against that baseline.
    store.observe(NEW, NEW_MAC, 948_500, 3_000, T0 + 3_000, "MacBook Pro M1", live(NEW));
    expect(store.totals(String(NEW))[0].rxBytes).toBe(merged + 500);
  });

  it("carries identity but not bytes when the buckets cover different months", () => {
    const store = tempStore();
    const july = new Date(2026, 6, 20, 12, 0, 0).getTime();
    const august = new Date(2026, 7, 2, 12, 0, 0).getTime();
    store.observe(OLD, OLD_MAC, 0, 0, july, "MacBook Pro M1", live(OLD));
    store.observe(OLD, OLD_MAC, 542_000, 44_000, july + 1_000, "MacBook Pro M1", live(OLD));
    store.observe(NEW, NEW_MAC, 0, 0, august, "MacBook Pro M1", live(NEW));
    store.observe(NEW, NEW_MAC, 7_000, 500, august + 1_000, "MacBook Pro M1", live(NEW));
    const before = store.totals(String(NEW))[0].rxBytes;
    expect(before).toBe(7_000);

    expect(store.merge(String(OLD), String(NEW))).toBe(true);
    const [total] = store.totals(String(NEW));
    expect(total.rxBytes).toBe(7_000); // July's bytes are NOT added to August
    expect(total.txBytes).toBe(500);
    expect(store.resolveKey(String(OLD))).toBe(String(NEW)); // identity still carried
  });

  it("resolves a key from before the merge to the surviving bucket", () => {
    const store = forked();
    store.merge(String(OLD), String(NEW));
    expect(store.resolveKey(String(OLD))).toBe(String(NEW));
    expect(store.resolveKey(String(NEW))).toBe(String(NEW));
    expect(store.resolveKey("never-seen")).toBe("never-seen");
  });

  it("follows a chain, so the oldest key reaches the newest bucket", () => {
    const store = forked();
    store.merge(String(OLD), String(NEW));
    // Rotated again: a third identity, merged onto the second.
    const THIRD = 77_777;
    store.observe(THIRD, "12:7a:14:XX:XX:XX", 0, 0, T0 + 10_000, "MacBook Pro M1", live(THIRD));
    expect(store.merge(String(NEW), String(THIRD))).toBe(true);
    expect(store.resolveKey(String(OLD))).toBe(String(THIRD));
    expect(store.resolveKey(String(NEW))).toBe(String(THIRD));
    expect(store.totals(String(THIRD))[0].rxBytes).toBe(542_000 + 48_000);
  });

  it("refuses a merge it cannot make sense of", () => {
    const store = forked();
    expect(store.merge(String(NEW), String(NEW))).toBe(false);
    expect(store.merge("absent", String(NEW))).toBe(false);
    expect(store.merge(String(OLD), "absent")).toBe(false);
    store.merge(String(OLD), String(NEW));
    // Already merged: both keys now resolve to one bucket.
    expect(store.merge(String(OLD), String(NEW))).toBe(false);
  });

  it("keeps aliases across a restart, and past the source bucket being compacted", () => {
    const path = tempPath();
    const first = new ClientTotalsStore(path);
    const idle = T0 - 36 * 3_600_000;
    first.observe(OLD, OLD_MAC, 0, 0, idle, "MacBook Pro M1", live(OLD));
    first.observe(NEW, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(NEW));
    first.merge(String(OLD), String(NEW));
    first.snapshot();

    const reopened = new ClientTotalsStore(path);
    expect(reopened.resolveKey(String(OLD))).toBe(String(NEW));
    // compact() prunes buckets by last-seen; the alias is not a bucket.
    reopened.compact(new Date(2026, 8, 15).getTime());
    expect(reopened.resolveKey(String(OLD))).toBe(String(NEW));
  });
});

// A private-address rotation changes the MAC and the clientId in one step, so
// neither is any use for recognising the device afterwards. The router's own
// per-client hash is the one identifier that might not move with them; when it
// holds, the total carries over with nobody being asked.
describe("ClientTotalsStore captiveClientId re-anchoring", () => {
  const OLD_MAC = "5a:c9:44:XX:XX:XX";
  const NEW_MAC = "ea:17:b5:XX:XX:XX";
  const CAPTIVE = "58d946a7736f5af5a35f948ba7def8c945a7ade22a9e5a1c32aa9cce79308b70";

  it("carries a total across a MAC and clientId change on a matching hash", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, T0, "MacBook Pro M1", live(1), CAPTIVE);
    store.observe(1, OLD_MAC, 5_000, 400, T0 + 1_000, "MacBook Pro M1", live(1), CAPTIVE);
    expect(store.totals("1")[0].rxBytes).toBe(5_000);

    // Rotated: new MAC, new clientId, same hash, and the old key is not live.
    store.observe(2, NEW_MAC, 100, 10, T0 + 2_000, undefined, live(2), CAPTIVE);
    expect(store.totals("1")).toHaveLength(0);
    const [total] = store.totals("2");
    expect(total.rxBytes).toBe(5_000); // re-baselined, nothing invented
    expect(total.macAddress).toBe(NEW_MAC); // survivor wears the address in use
    expect(total.name).toBe("MacBook Pro M1"); // label survives the rename gap
    expect(store.resolveKey("1")).toBe("2"); // old rows still resolve
  });

  it("counts forward from the carried total once re-baselined", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, T0, "Mac", live(1), CAPTIVE);
    store.observe(1, OLD_MAC, 5_000, 0, T0 + 1_000, "Mac", live(1), CAPTIVE);
    store.observe(2, NEW_MAC, 100, 0, T0 + 2_000, undefined, live(2), CAPTIVE);
    store.observe(2, NEW_MAC, 700, 0, T0 + 3_000, undefined, live(2), CAPTIVE);
    expect(store.totals("2")[0].rxBytes).toBe(5_600); // 5_000 + (700 - 100)
  });

  it("leaves a hash held by two concurrent devices alone", () => {
    const store = tempStore();
    const lk = store.notePoll([
      { clientId: 1, macAddress: OLD_MAC },
      { clientId: 2, macAddress: NEW_MAC },
    ]);
    store.observe(1, OLD_MAC, 0, 0, T0, "A", lk, CAPTIVE);
    store.observe(2, NEW_MAC, 0, 0, T0, "B", lk, CAPTIVE);
    // Both live, so a third identity on the same hash cannot claim either.
    store.observe(3, "aa:aa:aa:XX:XX:XX", 900, 0, T0 + 1_000, undefined, live(1, 2, 3), CAPTIVE);
    expect(store.totals("3")[0].rxBytes).toBe(0);
    expect(store.totals("1")).toHaveLength(1);
    expect(store.totals("2")).toHaveLength(1);
  });

  it("does not re-anchor a device whose hash the router never sent", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, T0, "Mac", live(1));
    store.observe(1, OLD_MAC, 5_000, 0, T0 + 1_000, "Mac", live(1));
    // No hash on either side, and the MAC changed too: nothing to anchor on.
    store.observe(2, NEW_MAC, 100, 0, T0 + 2_000, undefined, live(2));
    expect(store.totals("1")).toHaveLength(1);
    expect(store.totals("2")[0].rxBytes).toBe(0);
  });

  it("persists the hash, so a restart can still re-anchor on it", () => {
    const path = tempPath();
    const first = new ClientTotalsStore(path);
    first.observe(1, OLD_MAC, 0, 0, T0, "Mac", live(1), CAPTIVE);
    first.observe(1, OLD_MAC, 5_000, 0, T0 + 1_000, "Mac", live(1), CAPTIVE);
    first.snapshot();

    const reopened = new ClientTotalsStore(path);
    reopened.observe(2, NEW_MAC, 100, 0, T0 + 2_000, undefined, live(2), CAPTIVE);
    expect(reopened.totals("2")[0].rxBytes).toBe(5_000);
    expect(reopened.resolveKey("1")).toBe("2");
  });
});

describe("ClientTotalsStore.mergeCandidates", () => {
  const OLD_MAC = "5a:c9:44:XX:XX:XX";
  const NEW_MAC = "ea:17:b5:XX:XX:XX";
  const IDLE = T0 - 36 * 3_600_000;

  it("pairs an idle bucket with a newer one carrying the same user-given name", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "MacBook Pro M1", live(1));
    store.observe(1, OLD_MAC, 500, 60, IDLE + 1_000, "MacBook Pro M1", live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(2));
    store.observe(2, NEW_MAC, 40, 5, T0 + 1_000, "MacBook Pro M1", live(2));
    expect(store.mergeCandidates(T0 + 1_000)).toEqual([
      {
        fromKey: "1",
        toKey: "2",
        reason: "name",
        detail: "MacBook Pro M1",
        // Both buckets are in one month, so the figures add — and the candidate
        // states the total the prompt will quote.
        foldsBytes: true,
        resultRxBytes: 540,
        resultTxBytes: 65,
      },
    ]);
  });

  it("states that bytes will not fold across a month boundary", () => {
    const store = tempStore();
    const july = new Date(2026, 6, 20, 12, 0, 0).getTime();
    const august = new Date(2026, 7, 2, 12, 0, 0).getTime();
    store.observe(1, OLD_MAC, 0, 0, july, "MacBook Pro M1", live(1));
    store.observe(1, OLD_MAC, 500, 60, july + 1_000, "MacBook Pro M1", live(1));
    store.observe(2, NEW_MAC, 0, 0, august, "MacBook Pro M1", live(2));
    store.observe(2, NEW_MAC, 40, 5, august + 1_000, "MacBook Pro M1", live(2));
    const [candidate] = store.mergeCandidates(august + 1_000);
    expect(candidate.foldsBytes).toBe(false);
    // The survivor's own August figures, unchanged by the join.
    expect(candidate.resultRxBytes).toBe(40);
    expect(candidate.resultTxBytes).toBe(5);
  });

  it("states an outcome that matches what merge actually produces", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "MacBook Pro M1", live(1));
    store.observe(1, OLD_MAC, 500, 60, IDLE + 1_000, "MacBook Pro M1", live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(2));
    store.observe(2, NEW_MAC, 40, 5, T0 + 1_000, "MacBook Pro M1", live(2));
    const [candidate] = store.mergeCandidates(T0 + 1_000);
    store.merge(candidate.fromKey, candidate.toKey);
    const [total] = store.totals(candidate.toKey);
    expect(total.rxBytes).toBe(candidate.resultRxBytes);
    expect(total.txBytes).toBe(candidate.resultTxBytes);
  });

  it("proposes nothing for buckets with no name — absent is not evidence", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, undefined, live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, undefined, live(2));
    store.observe(3, "aa:aa:aa:XX:XX:XX", 0, 0, T0, "   ", live(3));
    expect(store.mergeCandidates(T0)).toEqual([]);
  });

  it("proposes nothing while both buckets are still being polled", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, T0 - 1_000, "MacBook Pro M1", live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(2));
    expect(store.mergeCandidates(T0)).toEqual([]);
  });

  it("proposes both when two idle buckets share a live bucket's name", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "MacBook Pro M1", live(1));
    store.observe(2, "aa:aa:aa:XX:XX:XX", 0, 0, IDLE + 1_000, "macbook pro m1", live(2));
    store.observe(3, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(3));
    const pairs = store.mergeCandidates(T0).map((c) => `${c.fromKey}->${c.toKey}`);
    expect(pairs).toContain("1->3");
    expect(pairs).toContain("2->3");
  });

  it("stops proposing a pair once it has been merged", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "MacBook Pro M1", live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, "MacBook Pro M1", live(2));
    store.merge("1", "2");
    expect(store.mergeCandidates(T0)).toEqual([]);
  });
});

// Two devices a user has named alike are indistinguishable to the odometer, so
// "these are different" is an answer only the user holds — and one the list would
// otherwise ask for again on every refresh.
describe("ClientTotalsStore.rejectMerge", () => {
  const OLD_MAC = "5a:c9:44:XX:XX:XX";
  const NEW_MAC = "ea:17:b5:XX:XX:XX";
  const IDLE = T0 - 36 * 3_600_000;

  function paired(): ClientTotalsStore {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "Floor Lamp", live(1));
    store.observe(2, NEW_MAC, 0, 0, T0, "Floor Lamp", live(2));
    return store;
  }

  it("stops offering a rejected pair", () => {
    const store = paired();
    expect(store.mergeCandidates(T0)).toHaveLength(1);
    expect(store.rejectMerge("1", "2")).toBe(true);
    expect(store.mergeCandidates(T0)).toEqual([]);
  });

  it("holds whichever way round it is asked", () => {
    const store = paired();
    store.rejectMerge("2", "1");
    expect(store.mergeCandidates(T0)).toEqual([]);
  });

  it("keeps both buckets — a rejection is not a delete", () => {
    const store = paired();
    store.rejectMerge("1", "2");
    expect(store.totals("1")).toHaveLength(1);
    expect(store.totals("2")).toHaveLength(1);
  });

  it("survives a restart, so the question is asked once", () => {
    const path = tempPath();
    const first = new ClientTotalsStore(path);
    first.observe(1, OLD_MAC, 0, 0, IDLE, "Floor Lamp", live(1));
    first.observe(2, NEW_MAC, 0, 0, T0, "Floor Lamp", live(2));
    first.rejectMerge("1", "2");
    first.snapshot();
    expect(new ClientTotalsStore(path).mergeCandidates(T0)).toEqual([]);
  });

  it("still applies after one side is merged onto a newer identity", () => {
    const store = tempStore();
    store.observe(1, OLD_MAC, 0, 0, IDLE, "Floor Lamp", live(1));
    store.observe(2, NEW_MAC, 0, 0, IDLE + 1_000, "Floor Lamp", live(2));
    store.rejectMerge("1", "2");
    // Bucket 2's device rotates; its total is merged forward onto key 3.
    store.observe(3, "12:7a:14:XX:XX:XX", 0, 0, T0, "Floor Lamp", live(3));
    expect(store.merge("2", "3")).toBe(true);
    // 1 vs 3 is the same pair of devices as 1 vs 2, so the answer still holds.
    expect(store.mergeCandidates(T0)).toEqual([]);
  });

  it("is retired by an explicit merge of the same pair", () => {
    const store = paired();
    store.rejectMerge("1", "2");
    expect(store.merge("1", "2")).toBe(true);
    expect(store.totals("2")).toHaveLength(1);
    expect(store.totals("1")).toHaveLength(0);
    // The retired rejection is not resurrected for a later pair on that key.
    store.observe(3, "aa:aa:aa:XX:XX:XX", 0, 0, IDLE, "Floor Lamp", live(3));
    expect(store.mergeCandidates(T0).map((c) => `${c.fromKey}->${c.toKey}`)).toContain("3->2");
  });

  it("refuses to keep a bucket apart from itself", () => {
    const store = paired();
    expect(store.rejectMerge("2", "2")).toBe(false);
    store.merge("1", "2");
    expect(store.rejectMerge("1", "2")).toBe(false);
  });

  it("refuses keys that name no bucket, so nothing junk is persisted", () => {
    const path = tempPath();
    const store = new ClientTotalsStore(path);
    store.observe(1, OLD_MAC, 0, 0, IDLE, "Floor Lamp", live(1));
    expect(store.rejectMerge("nope", "alsonope")).toBe(false);
    expect(store.rejectMerge("1", "alsonope")).toBe(false);
    expect(store.rejectMerge("alsonope", "1")).toBe(false);
    store.snapshot();
    expect(JSON.parse(readFileSync(path, "utf8")).rejectedPairs).toEqual([]);
  });
});
