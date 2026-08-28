import { describe, expect, it } from "vitest";
import { ClientTotalsCore, VERSION, type Snapshot, type TotalState } from "./clientTotals";

const MAC = "60:74:f4:11:22:33";
const CLIENT_ID = 4242;
const T0 = new Date(2026, 7, 12, 15, 30, 0).getTime();

function coreAt(rxBytes: number, atMs = T0): ClientTotalsCore {
  const core = new ClientTotalsCore();
  read(core, rxBytes, atMs);
  return core;
}

function read(
  core: ClientTotalsCore,
  rxBytes: number,
  atMs: number,
  selfTraffic?: { receivedBytes: number; sentBytes: number },
): void {
  const liveKeys = core.notePoll([{ clientId: CLIENT_ID, macAddress: MAC }]);
  core.observe(CLIENT_ID, MAC, rxBytes, 0, atMs, "Laptop", liveKeys, undefined, selfTraffic);
}

function monthlyRx(core: ClientTotalsCore): number {
  return core.totals(String(CLIENT_ID))[0].rxBytes;
}

describe("ClientTotalsCore self-traffic", () => {
  it("leaves a device that reports none exactly as it was", () => {
    const core = coreAt(1_000);
    read(core, 6_000, T0 + 200);
    expect(monthlyRx(core)).toBe(5_000);
    expect(core.correctedCounters(CLIENT_ID, MAC)).toEqual({ rxBytes: 6_000, txBytes: 0 });
  });

  it("takes the recorder's own traffic off the advance", () => {
    const core = coreAt(1_000);
    read(core, 6_000, T0 + 200, { receivedBytes: 1_500, sentBytes: 0 });
    expect(monthlyRx(core)).toBe(3_500);
  });

  it("carries what a still counter could not pay, and spends it when it steps", () => {
    const core = coreAt(1_000);
    for (let poll = 1; poll <= 4; poll += 1)
      read(core, 1_000, T0 + poll * 200, { receivedBytes: 500, sentBytes: 0 });
    expect(monthlyRx(core)).toBe(0);
    read(core, 11_000, T0 + 1_000, { receivedBytes: 500, sentBytes: 0 });
    expect(monthlyRx(core)).toBe(10_000 - 2_500);
  });

  it("never subtracts more than the interval carried", () => {
    const core = coreAt(1_000);
    read(core, 1_100, T0 + 200, { receivedBytes: 999_999, sentBytes: 0 });
    expect(monthlyRx(core)).toBe(0);
  });

  it("drops what it measured across a gap too wide to read", () => {
    // The counter adds nothing over such a span, so a debt paid down against the
    // reading that closes it would come out of traffic the user really spent.
    const core = coreAt(1_000);
    read(core, 5_000, T0 + 60_000, { receivedBytes: 900_000, sentBytes: 0 });
    expect(monthlyRx(core)).toBe(0);
    read(core, 15_000, T0 + 60_200);
    expect(monthlyRx(core)).toBe(10_000);
  });

  it("drops what it measured across a month roll", () => {
    const core = coreAt(1_000);
    const nextMonth = new Date(2026, 8, 1, 0, 0, 30).getTime();
    read(core, 5_000, nextMonth, { receivedBytes: 900_000, sentBytes: 0 });
    read(core, 9_000, nextMonth + 200);
    expect(monthlyRx(core)).toBe(4_000);
  });

  it("mirrors a counter reset in the corrected counter", () => {
    const core = coreAt(5_000_000);
    read(core, 8_000_000, T0 + 200);
    read(core, 4_000, T0 + 400, { receivedBytes: 1_000, sentBytes: 0 });
    expect(core.correctedCounters(CLIENT_ID, MAC)).toEqual({ rxBytes: 3_000, txBytes: 0 });
  });

  it("restores a snapshot written before it owed anything", () => {
    // Version 4 predates the debt fields; reading them as undefined would put
    // NaN into a lifetime total and destroy the month for every device.
    const legacy: TotalState = {
      clientId: CLIENT_ID,
      macAddress: MAC,
      lifetimeRx: 7_000,
      lifetimeTx: 0,
      monthAnchorRx: 0,
      monthAnchorTx: 0,
      sinceMs: T0,
      lastSeenMs: T0,
      periodMonth: 2026 * 12 + 7,
      prevRx: 1_000,
      prevTx: 0,
      lastPollMs: T0,
    };
    const snapshot: Snapshot = { version: VERSION, totals: [legacy], sharedMacs: [] };
    const core = new ClientTotalsCore();
    core.loadSnapshot(snapshot);

    read(core, 3_000, T0 + 200, { receivedBytes: 500, sentBytes: 0 });
    expect(Number.isNaN(monthlyRx(core))).toBe(false);
    expect(monthlyRx(core)).toBe(7_000 + 2_000 - 500);
  });

  it("reads the corrected counter from the bucket observe wrote to", () => {
    // An adoption's alias is inferred, so observe deliberately keeps writing to
    // the old id when it reports again. Resolving through the alias here would
    // hand the rate tracker a counter belonging to the surviving device.
    const core = new ClientTotalsCore();
    const OLD_ID = 111;
    const NEW_ID = 222;

    let liveKeys = core.notePoll([{ clientId: OLD_ID, macAddress: MAC }]);
    core.observe(OLD_ID, MAC, 1_000, 0, T0, "Laptop", liveKeys);
    liveKeys = core.notePoll([{ clientId: OLD_ID, macAddress: MAC }]);
    core.observe(OLD_ID, MAC, 4_000, 0, T0 + 200, "Laptop", liveKeys);

    // A new id on the same unshared MAC adopts the now-idle bucket.
    liveKeys = core.notePoll([{ clientId: NEW_ID, macAddress: MAC }]);
    core.observe(NEW_ID, MAC, 9_000, 0, T0 + 400, "Laptop", liveKeys);

    // The old id reports again, which observe treats as evidence against the
    // adoption and records under the old key.
    liveKeys = core.notePoll([
      { clientId: OLD_ID, macAddress: MAC },
      { clientId: NEW_ID, macAddress: MAC },
    ]);
    core.observe(OLD_ID, MAC, 500, 0, T0 + 600, "Laptop", liveKeys);
    core.observe(NEW_ID, MAC, 12_000, 0, T0 + 600, "Laptop", liveKeys);

    const oldCounters = core.correctedCounters(OLD_ID, MAC);
    const newCounters = core.correctedCounters(NEW_ID, MAC);
    expect(oldCounters).not.toEqual(newCounters);
    expect(newCounters).toEqual({ rxBytes: 12_000, txBytes: 0 });
  });

  it("keeps the two directions on separate debts", () => {
    const core = new ClientTotalsCore();
    let liveKeys = core.notePoll([{ clientId: CLIENT_ID, macAddress: MAC }]);
    core.observe(CLIENT_ID, MAC, 1_000, 1_000, T0, "Laptop", liveKeys);
    liveKeys = core.notePoll([{ clientId: CLIENT_ID, macAddress: MAC }]);
    core.observe(CLIENT_ID, MAC, 3_000, 3_000, T0 + 200, "Laptop", liveKeys, undefined, {
      receivedBytes: 500,
      sentBytes: 0,
    });
    const total = core.totals(String(CLIENT_ID))[0];
    expect(total.rxBytes).toBe(1_500);
    expect(total.txBytes).toBe(2_000);
  });
});
