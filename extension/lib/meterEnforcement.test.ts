import { describe, expect, it } from "vitest";
import { ClientTotalsCore } from "@core/clientTotals";
import { createRule, type MeterRule } from "@core/dataMeter";
import { InMemoryHistory } from "./history";
import { runMeters } from "./meterEnforcement";
import type { MeterHost } from "./meterHost";

const GB = 1_000_000_000;
const T0 = Date.UTC(2026, 7, 19, 12);
const KEY = "111";

/** Records every write so a test can assert what actually reached the account. */
function fakeHost(options: { signedIn?: boolean; fail?: string } = {}) {
  const writes: { clientId: number; paused: boolean }[] = [];
  const host: MeterHost = {
    signedIn: () => options.signedIn ?? true,
    setPaused: async (clientId, paused) => {
      writes.push({ clientId, paused });
      if (options.fail) throw new Error(options.fail);
    },
  };
  return { host, writes };
}

/** An odometer holding one device with `spent` bytes against its lifetime counter.
 *  The counters are deltas, so the first reading only sets the baseline. */
function odometerWith(spent: number, name = "Phone"): ClientTotalsCore {
  const odometer = new ClientTotalsCore(90_000);
  const live = new Set([KEY]);
  odometer.observe(Number(KEY), "", 0, 0, T0 - 1_000, name, live);
  odometer.observe(Number(KEY), "", spent, 0, T0, name, live);
  return odometer;
}

async function storeWith(rule: MeterRule): Promise<InMemoryHistory> {
  const store = new InMemoryHistory();
  await store.writeMeterRules([rule]);
  return store;
}

function ruleFor(overrides: Partial<MeterRule> = {}): MeterRule {
  return {
    ...createRule({
      clientKey: KEY,
      allocationBytes: 10 * GB,
      cycle: { kind: "daily" },
      lifetimeRx: 0,
      lifetimeTx: 0,
      nowMs: T0,
    }),
    ...overrides,
  };
}

describe("runMeters", () => {
  it("pauses the device and announces the trip when the allowance is spent", async () => {
    const store = await storeWith(ruleFor());
    const { host, writes } = fakeHost();

    const { transitions: alerts } = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([{ clientId: 111, paused: true }]);
    expect(alerts.map((alert) => alert.kind)).toEqual(["fired"]);
    expect(alerts[0].spec.firing).toBe("Phone reached its 10.0 GB data allowance");
    expect((await store.readMeterRules())[0].pauseState).toBe("applied");
  });

  it("announces a watch-only limit without writing to the account", async () => {
    const store = await storeWith(ruleFor({ autoPause: false }));
    const { host, writes } = fakeHost();

    const { transitions: alerts } = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([]);
    expect(alerts.map((alert) => alert.kind)).toEqual(["fired"]);
    expect((await store.readMeterRules())[0].pauseState).toBe("none");
  });

  it("keeps why a pause failed, and offers no advice it cannot act on", async () => {
    const store = await storeWith(ruleFor());
    const { host } = fakeHost({ fail: "Starlink answered 502" });

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    const rule = (await store.readMeterRules())[0];
    expect(rule.pauseState).toBe("failed");
    expect(rule.pauseError).toBe("Starlink answered 502");
  });

  it("retries a failed pause on a later drain", async () => {
    const store = await storeWith(ruleFor());
    const failing = fakeHost({ fail: "Starlink answered 502" });
    await runMeters(store, odometerWith(20 * GB), failing.host, T0 + 1_000);
    expect(failing.writes).toHaveLength(1);

    const recovered = fakeHost();
    await runMeters(store, odometerWith(20 * GB), recovered.host, T0 + 120_000);

    expect(recovered.writes).toEqual([{ clientId: 111, paused: true }]);
    expect((await store.readMeterRules())[0].pauseState).toBe("applied");
  });

  it("does not retry again inside the retry window", async () => {
    const store = await storeWith(ruleFor());
    await runMeters(store, odometerWith(20 * GB), fakeHost({ fail: "nope" }).host, T0 + 1_000);

    const again = fakeHost();
    await runMeters(store, odometerWith(20 * GB), again.host, T0 + 2_000);

    expect(again.writes).toEqual([]);
  });

  it("attempts nothing with no account, and says why the limit did not hold", async () => {
    const store = await storeWith(ruleFor());
    const { host, writes } = fakeHost({ signedIn: false });

    const { transitions: alerts } = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([]);
    const rule = (await store.readMeterRules())[0];
    expect(rule.pauseState).toBe("failed");
    expect(rule.pauseError).toBe("No Starlink account connected");
    expect(alerts[0].spec.advice).toMatch(/Connect your Starlink account/);
  });

  it("records what it announced, so history does not read back as a raw key", async () => {
    const store = await storeWith(ruleFor());
    const { host } = fakeHost();

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    const [episode] = await store.readAlerts(T0 + 1_000);
    expect(episode!.key).toBe(`dataLimit:${KEY}`);
    expect(episode!.label).toBe("Phone reached its 10.0 GB data allowance");
    expect(episode!.severity).toBe("warning");
  });

  it("keeps holding a device when the cycle rolls with no account", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    const { host, writes } = fakeHost({ signedIn: false });

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([]);
    // Still held. Forgetting it here is what strands the device: the router keeps
    // blocking it and nothing is left that knows to send the release.
    expect((await store.readMeterRules())[0].pauseState).toBe("applied");
  });

  it("sends the release it owed once the account is back", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    await runMeters(store, odometerWith(20 * GB), fakeHost({ signedIn: false }).host, T0 + 1_000);

    const back = fakeHost();
    await runMeters(store, odometerWith(20 * GB), back.host, T0 + 120_000);

    expect(back.writes).toEqual([{ clientId: 111, paused: false }]);
    expect((await store.readMeterRules())[0].pauseState).toBe("none");
  });

  it("releases the pause it applied when the cycle rolls", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    const { host, writes } = fakeHost();

    const { transitions: alerts } = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([{ clientId: 111, paused: false }]);
    // A router write and nothing else. The announcement retired a minute after it
    // was raised, which on a daily rule is long before the cycle turns over.
    expect(alerts).toEqual([]);
    expect((await store.readMeterRules())[0].pauseState).toBe("none");
  });

  it("retires the announcement after a minute, leaving the device capped", async () => {
    const store = await storeWith(ruleFor());
    const { host, writes } = fakeHost();

    const raised = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);
    expect(raised.transitions.map((alert) => alert.kind)).toEqual(["fired"]);

    const standing = await runMeters(store, odometerWith(20 * GB), host, T0 + 30_000);
    expect(standing.transitions).toEqual([]);
    expect(standing.active.map((alert) => alert.key)).toEqual([`dataLimit:${KEY}`]);

    const retired = await runMeters(store, odometerWith(20 * GB), host, T0 + 62_000);
    expect(retired.transitions.map((alert) => alert.kind)).toEqual(["cleared"]);
    expect(retired.active).toEqual([]);
    // The announcement is over; the cap it announced is not.
    const rule = (await store.readMeterRules())[0];
    expect(rule.actedThisCycle).toBe(true);
    expect(rule.pauseState).toBe("applied");
    expect(writes).toEqual([{ clientId: 111, paused: true }]);
  });

  it("retires an announcement no pause ever backed, so watch-only does not stick", async () => {
    const store = await storeWith(ruleFor({ autoPause: false }));
    const { host, writes } = fakeHost();

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);
    const retired = await runMeters(store, odometerWith(20 * GB), host, T0 + 62_000);

    expect(retired.transitions.map((alert) => alert.kind)).toEqual(["cleared"]);
    expect(retired.active).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("releases a pause it applied even after auto-pause was turned off", async () => {
    const store = await storeWith(
      ruleFor({
        autoPause: false,
        pauseState: "applied",
        actedThisCycle: true,
        periodEndMs: T0 + 500,
      }),
    );
    const { host, writes } = fakeHost();

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    expect(writes).toEqual([{ clientId: 111, paused: false }]);
    expect((await store.readMeterRules())[0].pauseState).toBe("none");
  });

  it("reports a spent allowance as active on every drain, not only the one it crossed", async () => {
    const store = await storeWith(ruleFor());
    const { host } = fakeHost();

    const first = await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);
    expect(first.transitions.map((alert) => alert.kind)).toEqual(["fired"]);
    expect(first.active.map((alert) => alert.key)).toEqual([`dataLimit:${KEY}`]);

    const next = await runMeters(store, odometerWith(20 * GB), host, T0 + 2_000);
    expect(next.transitions).toEqual([]);
    expect(next.active.map((alert) => alert.key)).toEqual([`dataLimit:${KEY}`]);
    expect(next.active[0]!.active).toBe(true);
  });

  it("reports nothing active while the device is under its allowance", async () => {
    const store = await storeWith(ruleFor());
    const { host } = fakeHost();

    const { transitions, active } = await runMeters(store, odometerWith(1 * GB), host, T0 + 1_000);

    expect(transitions).toEqual([]);
    expect(active).toEqual([]);
  });

  it("keeps holding a device when its release does not land", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    const { host } = fakeHost({ fail: "Starlink answered 502" });

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000);

    const rule = (await store.readMeterRules())[0]!;
    expect(rule.pauseState).toBe("applied");
    expect(rule.pauseError).toBe("Starlink answered 502");
  });

  it("retries a release that did not land", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    await runMeters(
      store,
      odometerWith(20 * GB),
      fakeHost({ fail: "Starlink answered 502" }).host,
      T0 + 1_000,
    );

    const recovered = fakeHost();
    await runMeters(store, odometerWith(20 * GB), recovered.host, T0 + 120_000);

    expect(recovered.writes).toEqual([{ clientId: 111, paused: false }]);
    expect((await store.readMeterRules())[0]!.pauseState).toBe("none");
  });

  it("waits out the window again when a release fails the same way twice", async () => {
    const store = await storeWith(
      ruleFor({ pauseState: "applied", actedThisCycle: true, periodEndMs: T0 + 500 }),
    );
    const rolled = fakeHost({ fail: "nope" });
    await runMeters(store, odometerWith(20 * GB), rolled.host, T0 + 1_000);
    const retried = fakeHost({ fail: "nope" });
    await runMeters(store, odometerWith(20 * GB), retried.host, T0 + 61_000);
    expect(retried.writes).toHaveLength(1);

    const tooSoon = fakeHost();
    await runMeters(store, odometerWith(20 * GB), tooSoon.host, T0 + 62_000);

    expect(tooSoon.writes).toEqual([]);
  });

  it("stops claiming a device the router says was unpaused by hand", async () => {
    const store = await storeWith(ruleFor({ pauseState: "applied", actedThisCycle: true }));
    const { host, writes } = fakeHost();

    await runMeters(store, odometerWith(20 * GB), host, T0 + 1_000, new Map([[KEY, false]]));

    // Nothing is owed: the device is already free, and re-pausing it would undo
    // what the user just did.
    expect(writes).toEqual([]);
    expect((await store.readMeterRules())[0]!.pauseState).toBe("none");
  });

  it("follows a merged device across the snapshot the next drain reloads", async () => {
    // The drain hands runMeters an odometer rebuilt from its snapshot, so the
    // merge that retired this key has to survive that round trip.
    const live = new ClientTotalsCore(90_000);
    const both = new Set([KEY, "222"]);
    live.observe(Number(KEY), "", 0, 0, T0 - 2_000, "Phone", both);
    live.observe(222, "", 0, 0, T0 - 2_000, "Phone", both);
    live.merge(KEY, "222");
    // A merge re-baselines the surviving bucket, so usage is counted from the
    // first reading after it, not from the one that carried the merge.
    const survivor = new Set(["222"]);
    live.observe(222, "", 0, 0, T0 - 1_000, "Phone", survivor);
    live.observe(222, "", 20 * GB, 0, T0, "Phone", survivor);

    const store = new InMemoryHistory();
    await store.writeMeterRules([ruleFor()]);
    await store.writeTotalsSnapshot(live.toSnapshot());

    const reloaded = new ClientTotalsCore(90_000);
    reloaded.loadSnapshot(live.toSnapshot());
    const { host, writes } = fakeHost();

    await runMeters(store, reloaded, host, T0 + 1_000);

    const rules = await store.readMeterRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].clientKey).toBe("222");
    expect(writes).toEqual([{ clientId: 222, paused: true }]);
  });

  it("keeps a rule whose device the odometer has not folded yet", async () => {
    const store = await storeWith(ruleFor());
    const { host, writes } = fakeHost();

    await runMeters(store, new ClientTotalsCore(90_000), host, T0 + 1_000);

    expect(await store.readMeterRules()).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  const OTHER = "222";

  /** Two devices, each having spent what it is given. */
  function pairOdometer(first: number, second: number): ClientTotalsCore {
    const odometer = new ClientTotalsCore(90_000);
    const live = new Set([KEY, OTHER]);
    odometer.observe(Number(KEY), "", 0, 0, T0 - 1_000, "Phone", live);
    odometer.observe(Number(OTHER), "", 0, 0, T0 - 1_000, "Tablet", live);
    odometer.observe(Number(KEY), "", first, 0, T0, "Phone", live);
    odometer.observe(Number(OTHER), "", second, 0, T0, "Tablet", live);
    return odometer;
  }

  /**
   * A group whose member rules are already open, anchored where the counters read
   * now — the state one drain after it was written. A rule anchors to the counter
   * it is created against, so a group has to exist before the spend it measures.
   */
  async function groupedStore(
    mode: "pooled" | "perMember",
    host: MeterHost,
    over: { countdownMs?: number } = {},
  ): Promise<InMemoryHistory> {
    const store = new InMemoryHistory();
    await store.writeDeviceGroups([
      {
        groupId: "kids",
        name: "Kids",
        memberKeys: [KEY, OTHER],
        allocationBytes: 10 * GB,
        autoPause: true,
        cycle: over.countdownMs === undefined ? { kind: "daily" } : { kind: "once" },
        mode,
        updatedMs: T0,
        ...over,
      },
    ]);
    await runMeters(store, pairOdometer(0, 0), host, T0);
    return store;
  }

  it("takes a whole shared group dark on the reading that puts the sum over", async () => {
    const { host, writes } = fakeHost();
    const store = await groupedStore("pooled", host);

    const { transitions: alerts } = await runMeters(
      store,
      pairOdometer(6 * GB, 5 * GB),
      host,
      T0 + 1_000,
    );

    // Neither device is over 10 GB alone. The group is, so both are held.
    expect(writes.map((write) => write.clientId).sort()).toEqual([111, 222]);
    expect(writes.every((write) => write.paused)).toBe(true);
    // One group, one announcement, named for the group rather than for whichever
    // member's reading happened to cross the sum.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].spec.firing).toBe("Kids reached their 10.0 GB data allowance");
    expect(alerts[0].key).toBe("dataLimit:group:kids");
  });

  it("holds only the member that is over when each carries the allowance itself", async () => {
    const { host, writes } = fakeHost();
    const store = await groupedStore("perMember", host);

    const { transitions: alerts } = await runMeters(
      store,
      pairOdometer(12 * GB, 1 * GB),
      host,
      T0 + 1_000,
    );

    expect(writes).toEqual([{ clientId: 111, paused: true }]);
    // Its own device key, since nothing is shared here.
    expect(alerts.map((alert) => alert.key)).toEqual(["dataLimit:111"]);
  });

  it("releases a member dropped from its group, which nothing else would free", async () => {
    const { host, writes } = fakeHost();
    const store = await groupedStore("pooled", host);
    await runMeters(store, pairOdometer(6 * GB, 5 * GB), host, T0 + 1_000);
    writes.length = 0;

    const groups = await store.readDeviceGroups();
    await store.writeDeviceGroups([{ ...groups[0], memberKeys: [KEY] }]);
    await runMeters(store, pairOdometer(6 * GB, 5 * GB), host, T0 + 2_000);

    // Its rule is gone, so nothing is left that knows the router is holding it.
    expect(writes).toEqual([{ clientId: 222, paused: false }]);
    expect((await store.readMeterRules()).map((rule) => rule.clientKey)).toEqual([KEY]);
  });

  it("takes a whole group dark together when its timer runs out", async () => {
    const { host, writes } = fakeHost();
    const store = await groupedStore("pooled", host, { countdownMs: 3_600_000 });

    // Well inside the hour. Spending everything does not end a countdown.
    await runMeters(store, pairOdometer(900 * GB, 900 * GB), host, T0 + 1_000);
    expect(writes).toEqual([]);

    await runMeters(store, pairOdometer(900 * GB, 900 * GB), host, T0 + 3_600_001);
    expect(writes.map((write) => write.clientId).sort()).toEqual([111, 222]);
    expect(writes.every((write) => write.paused)).toBe(true);
  });
});
