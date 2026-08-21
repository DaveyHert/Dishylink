import { describe, expect, it } from "vitest";
import { routeApiRequest } from "./apiRouter";
import { runMeters } from "./meterEnforcement";
import type { MeterHost } from "./meterHost";
import { InMemoryHistory, type AlertSource } from "./history";
import type { AlertTransition } from "@core/alertEngine";
import { ClientTotalsCore } from "@core/clientTotals";
import type { EnergySummary } from "../../src/hooks/useEnergyHistory";
import { cycleParams } from "../../src/hooks/useDataMeter";
import { usageBytes, type MeterCycle, type MeterRule } from "@core/dataMeter";

const NOW = new Date(1_600_000_000_000);
const GB = 1_000_000_000;
const EMPTY_CURSOR = { counter: 0, newestSampleMs: 0 };

/** A transition as core/alertEngine would report it. The store records edges it
 *  is handed rather than finding them, so these routes are tested against the
 *  same input the drain gives it. Wording is irrelevant here — only the edge is. */
function transition(
  kind: "fired" | "cleared",
  source: AlertSource,
  key: string,
  atMs: number,
): AlertTransition[] {
  return [
    {
      kind,
      source,
      key,
      atMs,
      spec: { key, ok: "", firing: "", severity: "warning" },
    },
  ];
}

const fired = (source: AlertSource, key: string, atMs: number) =>
  transition("fired", source, key, atMs);
const cleared = (source: AlertSource, key: string, atMs: number) =>
  transition("cleared", source, key, atMs);

describe("routeApiRequest", () => {
  it("summarizes recorded minutes for /api/energy", async () => {
    const store = new InMemoryHistory();
    // A minute inside the 1h window ending at NOW, worth exactly 1 kWh.
    await store.commit(
      [
        {
          minute: 1_599_998_400,
          wattSeconds: 3_600_000,
          samples: 60,
          downlinkBits: 0,
          uplinkBits: 0,
        },
      ],
      EMPTY_CURSOR,
    );

    const reply = await routeApiRequest(store, "/api/energy?range=1h", NOW);

    expect(reply.status).toBe(200);
    const summary = reply.body as EnergySummary;
    expect(summary.totalKWh).toBe(1);
    expect(summary.range).toBe("1h");
  });

  it("serves the same buckets for /api/usage", async () => {
    const store = new InMemoryHistory();
    await store.commit(
      [{ minute: 1_599_998_400, wattSeconds: 0, samples: 60, downlinkBits: 8e9, uplinkBits: 0 }],
      EMPTY_CURSOR,
    );

    const reply = await routeApiRequest(store, "/api/usage?range=1h", NOW);

    expect(reply.status).toBe(200);
    expect((reply.body as { totalDownGB: number }).totalDownGB).toBe(1);
  });

  it("defaults an unknown range to today rather than throwing", async () => {
    const reply = await routeApiRequest(new InMemoryHistory(), "/api/energy?range=bogus", NOW);
    expect(reply.status).toBe(200);
    expect((reply.body as { range: string }).range).toBe("today");
  });

  it("serves recorded outages newest-first for /api/outages", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    await store.putOutages(
      [
        { startMs: t - 5_000, durationMs: 5_000, cause: "NO_SCHEDULE", severity: "warning" },
        { startMs: t - 1_000, durationMs: 2_000, cause: "OBSTRUCTED", severity: "warning" },
      ],
      t,
    );
    // A re-seen episode (same startMs) updates rather than duplicates.
    await store.putOutages(
      [{ startMs: t - 5_000, durationMs: 7_000, cause: "NO_SCHEDULE", severity: "warning" }],
      t,
    );

    const reply = await routeApiRequest(store, "/api/outages", NOW);

    expect(reply.status).toBe(200);
    const { events } = reply.body as { events: Array<{ startMs: number; durationMs: number }> };
    expect(events.map((e) => e.startMs)).toEqual([t - 1_000, t - 5_000]);
    expect(events[1]!.durationMs).toBe(7_000);
  });

  it("serves the dish's raw 1 Hz window within the requested minutes for /api/samples", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const sample = (timestampMs: number, powerW: number) => ({
      timestampMs,
      latencyMs: null,
      dropRate: 0,
      downlinkBps: 0,
      uplinkBps: 0,
      powerW,
      routerLatencyMs: null,
      routerPingSuccessPercent: null,
    });
    await store.putSamples([sample(t - 2_000, 9), sample(t - 1_000, 10)], t);
    const reply = await routeApiRequest(store, "/api/samples?minutes=360", NOW);
    expect(reply.status).toBe(200);
    const { samples } = reply.body as { samples: Array<{ timestampMs: number; powerW: number }> };
    expect(samples.map((s) => s.timestampMs)).toEqual([t - 2_000, t - 1_000]); // oldest first
  });

  it("serves the latest radio readings for /api/radio", async () => {
    const store = new InMemoryHistory();
    await store.putRadio([{ band: "RF_5GHZ", tempC: 60, dutyCycle: 100 }], NOW.getTime());
    await store.putRadio([{ band: "RF_5GHZ", tempC: 70, dutyCycle: 40 }], NOW.getTime() + 5_000);

    const reply = await routeApiRequest(store, "/api/radio", NOW);

    expect(reply.status).toBe(200);
    const body = reply.body as {
      current: Array<{ tempC: number; dutyCycle: number }>;
      atMs: number;
    };
    expect(body.current[0]!.tempC).toBe(70); // the latest live reading wins
    expect(body.current[0]!.dutyCycle).toBe(40);
    expect(body).not.toHaveProperty("history");
  });

  it("records the engine's transitions as open then closed episodes for /api/alerts", async () => {
    const store = new InMemoryHistory();
    await store.applyAlertTransitions(fired("dish", "thermalThrottle", 1_000), 1_000);
    await store.applyAlertTransitions(cleared("dish", "thermalThrottle", 5_000), 5_000);
    // A still-open episode on another key stays open.
    await store.applyAlertTransitions(fired("router", "roamingSwitchDetected", 6_000), 6_000);

    const reply = await routeApiRequest(store, "/api/alerts", new Date(10_000));

    expect(reply.status).toBe(200);
    const { episodes } = reply.body as {
      episodes: Array<{ source: string; key: string; startMs: number; endMs: number | null }>;
    };
    const throttle = episodes.find((e) => e.key === "thermalThrottle")!;
    expect(throttle.startMs).toBe(1_000);
    expect(throttle.endMs).toBe(5_000);
    expect(episodes.find((e) => e.key === "roamingSwitchDetected")!.endMs).toBeNull();
  });

  it("serves only thermal keys for /api/thermal, in the source-less shape", async () => {
    const store = new InMemoryHistory();
    await store.applyAlertTransitions(
      [...fired("dish", "thermalThrottle", 2_000), ...fired("dish", "dishWaterDetected", 2_000)],
      2_000,
    );

    const reply = await routeApiRequest(store, "/api/thermal", new Date(10_000));

    const { episodes } = reply.body as { episodes: Array<{ alertKey: string }> };
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.alertKey).toBe("thermalThrottle");
  });

  it("serves obstruction snapshots oldest-first for the scrubber", async () => {
    const store = new InMemoryHistory();
    await store.putObstruction({ takenAtMs: 9_000, gridSize: 4, packedCells: "b" });
    await store.putObstruction({ takenAtMs: 3_000, gridSize: 4, packedCells: "a" });

    const reply = await routeApiRequest(store, "/api/obstruction/snapshots", new Date(10_000));

    expect(reply.status).toBe(200);
    const { snapshots } = reply.body as { snapshots: Array<{ takenAtMs: number }> };
    expect(snapshots.map((s) => s.takenAtMs)).toEqual([3_000, 9_000]);
  });

  it("serves per-minute client history and the usage odometer for /api/clients", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const minute = Math.floor(t / 60_000) * 60;
    await store.putClientMinutes(
      [
        {
          minute,
          key: "42",
          macAddress: "aa",
          name: "Laptop",
          downMbps: 5,
          upMbps: 1,
          rxBytes: 100,
          txBytes: 20,
        },
        {
          minute: minute - 60,
          key: "7",
          macAddress: "bb",
          downMbps: 2,
          upMbps: 3,
          rxBytes: 50,
          txBytes: 10,
        },
      ],
      t,
    );
    // A device the odometer has been tracking, so `totals` is non-empty. The 90s
    // window is the extension recorder's, so a 60s gap between polls is measured.
    const odometer = new ClientTotalsCore(90_000);
    const live = odometer.notePoll([{ clientId: 42, macAddress: "aa" }]);
    odometer.observe(42, "aa", 100, 20, t - 60_000, "Laptop", live);
    odometer.observe(42, "aa", 500, 220, t, "Laptop", live);
    await store.writeTotalsSnapshot(odometer.toSnapshot());

    const reply = await routeApiRequest(store, "/api/clients?hours=6", NOW);
    expect(reply.status).toBe(200);
    const body = reply.body as {
      history: Array<{ key: string; downMbps: number }>;
      totals: Array<{ clientId?: number; rxBytes: number }>;
    };
    expect(body.history.map((r) => r.key)).toEqual(["7", "42"]); // oldest first
    expect(body.totals[0]!.clientId).toBe(42);
    expect(body.totals[0]!.rxBytes).toBe(400); // 500 - 100 across one measured gap
  });

  it("resets one device's usage total via POST /api/clients/totals/reset", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const odometer = new ClientTotalsCore(90_000);
    const live = odometer.notePoll([{ clientId: 42, macAddress: "aa" }]);
    odometer.observe(42, "aa", 0, 0, t - 60_000, "Laptop", live);
    odometer.observe(42, "aa", 400, 100, t, "Laptop", live);
    await store.writeTotalsSnapshot(odometer.toSnapshot());

    const reset = await routeApiRequest(store, "/api/clients/totals/reset?client=42", NOW, "POST");
    expect(reset.body).toEqual({ reset: true });
    const after = await routeApiRequest(store, "/api/clients/totals", NOW);
    const { totals } = after.body as { totals: Array<{ rxBytes: number }> };
    expect(totals[0]!.rxBytes).toBe(0); // zeroed, still listed
  });

  it("deletes one device's record via DELETE /api/clients/totals", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const odometer = new ClientTotalsCore(90_000);
    const live = odometer.notePoll([{ clientId: 42, macAddress: "aa" }]);
    odometer.observe(42, "aa", 400, 100, t, "Laptop", live);
    await store.writeTotalsSnapshot(odometer.toSnapshot());

    const del = await routeApiRequest(store, "/api/clients/totals?client=42", NOW, "DELETE");
    expect(del.body).toEqual({ removed: true });
    const after = await routeApiRequest(store, "/api/clients/totals", NOW);
    expect((after.body as { totals: unknown[] }).totals).toEqual([]);
  });

  // The extension is a standalone recorder, so a split record has to be answerable
  // here too — not only on the desktop. Same core, but its own route and its own
  // snapshot write, either of which could be missing without the core noticing.
  /** A store holding one device forked into an idle and a live bucket, both named
   *  alike — what a private-MAC rotation leaves behind. */
  async function forkedStore(): Promise<InMemoryHistory> {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const odometer = new ClientTotalsCore(90_000);
    const older = odometer.notePoll([{ clientId: 1, macAddress: "aa" }]);
    odometer.observe(1, "aa", 0, 0, t - 36 * 3_600_000, "Laptop", older);
    odometer.observe(1, "aa", 500, 100, t - 36 * 3_600_000 + 1_000, "Laptop", older);
    const newer = odometer.notePoll([{ clientId: 2, macAddress: "bb" }]);
    odometer.observe(2, "bb", 0, 0, t - 1_000, "Laptop", newer);
    odometer.observe(2, "bb", 40, 10, t, "Laptop", newer);
    await store.writeTotalsSnapshot(odometer.toSnapshot());
    return store;
  }

  it("offers the split record as a candidate on GET /api/clients/totals", async () => {
    const read = await routeApiRequest(await forkedStore(), "/api/clients/totals", NOW);
    const { totals, mergeCandidates } = read.body as {
      totals: Array<{ clientId?: number }>;
      mergeCandidates: Array<{ fromKey: string; toKey: string; foldsBytes: boolean }>;
    };
    expect(mergeCandidates).toHaveLength(1);
    expect(mergeCandidates[0]!.fromKey).toBe("1");
    expect(mergeCandidates[0]!.toKey).toBe("2");
    expect(mergeCandidates[0]!.foldsBytes).toBe(true);
    // Every candidate names a row in the same reply, or the prompt cannot render.
    const keys = totals.map((t) => String(t.clientId));
    expect(keys).toContain("1");
    expect(keys).toContain("2");
  });

  it("merges the two buckets via POST /api/clients/totals/merge", async () => {
    const store = await forkedStore();
    const merged = await routeApiRequest(
      store,
      "/api/clients/totals/merge?from=1&to=2",
      NOW,
      "POST",
    );
    expect(merged.body).toEqual({ merged: true });
    const after = await routeApiRequest(store, "/api/clients/totals", NOW);
    const { totals, mergeCandidates } = after.body as {
      totals: Array<{ clientId?: number; rxBytes: number; txBytes: number }>;
      mergeCandidates: unknown[];
    };
    expect(totals).toHaveLength(1);
    expect(totals[0]!.clientId).toBe(2);
    expect(totals[0]!.rxBytes).toBe(540); // 500 carried over + 40 measured
    expect(totals[0]!.txBytes).toBe(110);
    expect(mergeCandidates).toEqual([]); // answered, so no longer asked
  });

  it("carries a merged device's chart history onto the surviving identity", async () => {
    const store = await forkedStore();
    const t = NOW.getTime();
    const minute = Math.floor(t / 60_000) * 60;
    // Throughput recorded under the old identity (1), then the new one (2).
    await store.putClientMinutes(
      [
        {
          minute: minute - 120,
          key: "1",
          macAddress: "aa",
          downMbps: 5,
          upMbps: 1,
          rxBytes: 0,
          txBytes: 0,
        },
        {
          minute: minute - 60,
          key: "2",
          macAddress: "bb",
          downMbps: 8,
          upMbps: 2,
          rxBytes: 0,
          txBytes: 0,
        },
      ],
      t,
    );
    await routeApiRequest(store, "/api/clients/totals/merge?from=1&to=2", NOW, "POST");

    const reply = await routeApiRequest(store, "/api/clients?client=2&hours=6", NOW);
    const { history } = reply.body as { history: Array<{ key: string; downMbps: number }> };
    // The old-identity row (5) now answers to device 2, beside its own (8), instead
    // of being stranded under a key no device reports — the total merged, so does this.
    expect(history.map((r) => r.key)).toEqual(["2", "2"]);
    expect(history.map((r) => r.downMbps)).toEqual([5, 8]);
  });

  it("records 'different devices' via the same route, and stops offering the pair", async () => {
    const store = await forkedStore();
    const rejected = await routeApiRequest(
      store,
      "/api/clients/totals/merge?from=1&to=2&distinct=1",
      NOW,
      "POST",
    );
    expect(rejected.body).toEqual({ rejected: true });
    const after = await routeApiRequest(store, "/api/clients/totals", NOW);
    const { totals, mergeCandidates } = after.body as {
      totals: unknown[];
      mergeCandidates: unknown[];
    };
    expect(totals).toHaveLength(2); // a rejection keeps both records
    expect(mergeCandidates).toEqual([]);
  });

  it("refuses a merge naming a record it does not hold", async () => {
    const store = await forkedStore();
    const merged = await routeApiRequest(
      store,
      "/api/clients/totals/merge?from=1&to=absent",
      NOW,
      "POST",
    );
    expect(merged.body).toEqual({ merged: false });
    const after = await routeApiRequest(store, "/api/clients/totals", NOW);
    expect((after.body as { totals: unknown[] }).totals).toHaveLength(2);
  });

  it("stores posted 1 Hz client samples that a since-tail read then returns", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const body = JSON.stringify([
      { key: "42", macAddress: "aa", atMs: t - 1_000, downMbps: 9, upMbps: 2 },
    ]);
    const post = await routeApiRequest(store, "/api/clients/samples", NOW, "POST", body);
    expect(post.body).toEqual({ stored: 1 });
    const read = await routeApiRequest(store, `/api/clients?samples=1&since=${t - 5_000}`, NOW);
    const { samples } = read.body as { samples: Array<{ atMs: number }> };
    expect(samples.map((s) => s.atMs)).toEqual([t - 1_000]);
  });

  it("omits history but keeps samples for a since-tail /api/clients read", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    await store.putClientSamples(
      [{ key: "42", macAddress: "aa", atMs: t - 1_000, downMbps: 9, upMbps: 2 }],
      t,
    );
    const reply = await routeApiRequest(store, `/api/clients?samples=1&since=${t - 5_000}`, NOW);
    const body = reply.body as { history: unknown[]; samples: Array<{ atMs: number }> };
    expect(body.history).toEqual([]); // a tail already holds the minute rows
    expect(body.samples.map((s) => s.atMs)).toEqual([t - 1_000]);
  });

  /** A device the odometer knows, so a rule written against it has counters. */
  async function meteredStore(): Promise<InMemoryHistory> {
    const store = new InMemoryHistory();
    const odometer = new ClientTotalsCore(90_000);
    const live = odometer.notePoll([{ clientId: 42, macAddress: "aa" }]);
    odometer.observe(42, "aa", 0, 0, NOW.getTime() - 60_000, "Laptop", live);
    odometer.observe(42, "aa", 400, 100, NOW.getTime(), "Laptop", live);
    await store.writeTotalsSnapshot(odometer.toSnapshot());
    return store;
  }

  async function saveCycle(store: InMemoryHistory, cycle: MeterCycle): Promise<MeterRule> {
    const query = new URLSearchParams({
      client: "42",
      allocation: String(50_000_000_000),
      autoPause: "1",
      ...cycleParams(cycle),
    });
    const reply = await routeApiRequest(store, `/api/clients/meters?${query}`, NOW, "POST");
    expect(reply.status).toBe(200);
    return (reply.body as { rule: MeterRule }).rule;
  }

  /** A store metering device 42, with the router already holding it. */
  async function holdingStore(): Promise<InMemoryHistory> {
    const store = await meteredStore();
    const saved = await saveCycle(store, { kind: "daily" });
    await store.writeMeterRules([{ ...saved, actedThisCycle: true }]);
    await store.writeDevicePauses([{ clientKey: "42", state: "applied", checkedMs: 0 }]);
    return store;
  }

  function recordingHost() {
    const writes: { clientId: number; paused: boolean }[] = [];
    return {
      writes,
      host: {
        signedIn: () => true,
        setPaused: async (clientId: number, paused: boolean) => {
          writes.push({ clientId, paused });
        },
      },
    };
  }

  /** The drain that settles what the routes leave: it releases any device the
   *  rules no longer hold, whatever became of the rule that asked for the block. */
  async function drain(store: InMemoryHistory, host: MeterHost) {
    const odometer = new ClientTotalsCore();
    const snapshot = await store.readTotalsSnapshot();
    if (snapshot) odometer.loadSnapshot(snapshot);
    await runMeters(store, odometer, host, NOW.getTime() + 120_000);
  }

  it("releases a device it is holding once its rule is deleted", async () => {
    const store = await holdingStore();
    const { host, writes } = recordingHost();

    const reply = await routeApiRequest(
      store,
      "/api/clients/meters?client=42",
      NOW,
      "DELETE",
      undefined,
      host,
    );
    expect(reply.body).toEqual({ removed: true });

    await drain(store, host);

    // Nothing holds the device now, and the block outlived the rule so there is
    // still something that knows to lift it.
    expect(writes).toEqual([{ clientId: 42, paused: false }]);
  });

  it("releases a device it is holding once its cycle is started over", async () => {
    const store = await holdingStore();
    const { host, writes } = recordingHost();

    await routeApiRequest(
      store,
      "/api/clients/meters/reset?client=42",
      NOW,
      "POST",
      undefined,
      host,
    );
    expect((await store.readMeterRules())[0]!.actedThisCycle).toBe(false);

    await drain(store, host);

    expect(writes).toEqual([{ clientId: 42, paused: false }]);
    expect((await store.readDevicePauses())[0]?.state).toBe("none");
  });

  it("stores the billing day the card sent, not a calendar month", async () => {
    const store = await meteredStore();
    const saved = await saveCycle(store, { kind: "billing", day: 6 });
    expect(saved.cycle).toEqual({ kind: "billing", day: 6 });
    // Read back, because the answer above could be right while the write is not.
    const read = await routeApiRequest(store, "/api/clients/meters?client=42", NOW);
    const { rules } = read.body as { rules: MeterRule[] };
    expect(rules[0]!.cycle).toEqual({ kind: "billing", day: 6 });
    expect(new Date(rules[0]!.periodStartMs).getDate()).toBe(6);
  });

  it("carries every cycle kind's own fields across the query", async () => {
    const store = await meteredStore();
    for (const cycle of [
      { kind: "daily" },
      { kind: "weekly", weekday: 4 },
      { kind: "monthly", day: 17 },
      { kind: "billing", day: 22 },
      { kind: "once" },
    ] satisfies MeterCycle[]) {
      expect(await saveCycle(store, cycle).then((rule) => rule.cycle)).toEqual(cycle);
    }
  });

  it("takes Monday, not Sunday, when a weekly rule arrives without a weekday", async () => {
    const store = await meteredStore();
    const query = "client=42&allocation=50000000000&autoPause=1&cycle=weekly";
    const reply = await routeApiRequest(store, `/api/clients/meters?${query}`, NOW, "POST");
    expect((reply.body as { rule: MeterRule }).rule.cycle).toEqual({ kind: "weekly", weekday: 1 });
  });

  it("names the device on a rule it serves, falling back as the desktop does", async () => {
    const store = await meteredStore();
    await saveCycle(store, { kind: "monthly", day: 1 });
    const read = await routeApiRequest(store, "/api/clients/meters?client=42", NOW);
    const { rules, pauseEnforceable } = read.body as {
      rules: Array<{ deviceName: string }>;
      pauseEnforceable: boolean;
    };
    expect(rules[0]!.deviceName).toBe("Laptop");
    // No session was injected, so nothing here can enforce a pause and says so.
    expect(pauseEnforceable).toBe(false);
  });

  it("falls back to `device <key>` for a rule the odometer has no name for", async () => {
    const store = await meteredStore();
    await store.writeMeterRules([
      { ...(await saveCycle(store, { kind: "monthly", day: 1 })), clientKey: "99" },
    ]);
    const read = await routeApiRequest(store, "/api/clients/meters?client=99", NOW);
    const { rules } = read.body as { rules: Array<{ deviceName: string }> };
    expect(rules[0]!.deviceName).toBe("device 99");
  });

  it("keeps an edited device's own rule where it already sat rather than moving it to the end", async () => {
    const store = await pairedStore();
    const query = (client: string) =>
      `client=${client}&allocation=50000000000&autoPause=1&cycle=monthly&day=1`;
    await routeApiRequest(store, `/api/clients/meters?${query("42")}`, NOW, "POST");
    await routeApiRequest(store, `/api/clients/meters?${query("43")}`, NOW, "POST");

    await routeApiRequest(
      store,
      `/api/clients/meters?${query("42")}&allocation=90000000000`,
      NOW,
      "POST",
    );

    const rules = await store.readMeterRules();
    expect(rules.map((rule) => rule.clientKey)).toEqual(["42", "43"]);
  });

  /** Two devices the odometer knows, so a group written over them has counters. */
  async function pairedStore(): Promise<InMemoryHistory> {
    const store = new InMemoryHistory();
    const odometer = new ClientTotalsCore(90_000);
    const live = odometer.notePoll([
      { clientId: 42, macAddress: "aa" },
      { clientId: 43, macAddress: "bb" },
    ]);
    odometer.observe(42, "aa", 0, 0, NOW.getTime() - 60_000, "Laptop", live);
    odometer.observe(43, "bb", 0, 0, NOW.getTime() - 60_000, "Tablet", live);
    odometer.observe(42, "aa", 400, 100, NOW.getTime(), "Laptop", live);
    odometer.observe(43, "bb", 400, 100, NOW.getTime(), "Tablet", live);
    await store.writeTotalsSnapshot(odometer.toSnapshot());
    return store;
  }

  async function saveGroup(
    store: InMemoryHistory,
    over: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const query = new URLSearchParams({
      name: "Kids",
      members: "42,43",
      allocation: String(50_000_000_000),
      autoPause: "1",
      cycle: "monthly",
      day: "1",
      ...over,
    });
    return routeApiRequest(store, `/api/clients/groups?${query}`, NOW, "POST");
  }

  it("projects a group's member rules on the write, not on the next drain", async () => {
    const store = await pairedStore();
    expect((await saveGroup(store)).status).toBe(200);
    // A card that just wrote this would otherwise read both members as unmetered
    // for up to a drain.
    const rules = await store.readMeterRules();
    expect(rules.map((rule) => rule.clientKey).sort()).toEqual(["42", "43"]);
    expect(rules.every((rule) => rule.allocationBytes === 50_000_000_000)).toBe(true);
  });

  it("keeps an edited group where it already sat rather than moving it to the end", async () => {
    const store = await pairedStore();
    const first = (await saveGroup(store, { name: "First", members: "42" })).body as {
      group: { groupId: string };
    };
    await saveGroup(store, { name: "Second", members: "43" });

    await saveGroup(store, { group: first.group.groupId, name: "First, renamed", members: "42" });

    const groups = await store.readDeviceGroups();
    expect(groups.map((group) => group.name)).toEqual(["First, renamed", "Second"]);
  });

  it("takes each, not shared, when a group arrives naming no mode", async () => {
    const store = await pairedStore();
    await saveGroup(store);
    // The same default the form opens on, so a write that omits it never means
    // one thing here and another on the card that sent it.
    expect((await store.readDeviceGroups())[0]!.mode).toBe("perMember");
    expect((await store.readMeterRules()).some((rule) => rule.sharedAllowance)).toBe(false);
  });

  it("charges a shared group's members the whole group's usage", async () => {
    const store = await pairedStore();
    await saveGroup(store, { mode: "pooled", allocation: String(600) });
    // A rule anchors to the counter as it reads when it is written, so the spend
    // has to happen after it. This is what a drain would have folded in.
    await store.writeMeterRules(
      (await store.readMeterRules()).map((rule) => ({ ...rule, observedRx: rule.anchorRx + 500 })),
    );

    const read = await routeApiRequest(store, "/api/clients/meters", NOW);
    const { rules } = read.body as { rules: Array<{ usageBytes: number }> };
    expect(rules).toHaveLength(2);
    // Neither device is over 600 alone; together they are, which is the whole
    // point of sharing one allowance, so each is judged on the sum.
    for (const rule of rules) expect(rule.usageBytes).toBe(1000);
  });

  it("releases a device the group it was edited out of was holding", async () => {
    const store = await pairedStore();
    await saveGroup(store);
    await store.writeDevicePauses([{ clientKey: "43", state: "applied", checkedMs: 0 }]);
    const groupId = (await store.readDeviceGroups())[0]!.groupId;
    const { host, writes } = recordingHost();

    await routeApiRequest(
      store,
      `/api/clients/groups?${new URLSearchParams({
        group: groupId,
        name: "Kids",
        members: "42",
        allocation: String(50_000_000_000),
        autoPause: "1",
        cycle: "monthly",
        day: "1",
      })}`,
      NOW,
      "POST",
      undefined,
      host,
    );
    expect((await store.readMeterRules()).map((rule) => rule.clientKey)).toEqual(["42"]);

    await drain(store, host);

    // The rule that asked for the block went with the membership; the block did
    // not, so the drain still finds a device nothing is holding.
    expect(writes).toEqual([{ clientId: 43, paused: false }]);
  });

  it("releases every device a deleted group was holding", async () => {
    const store = await pairedStore();
    await saveGroup(store, { mode: "pooled" });
    await store.writeDevicePauses([
      { clientKey: "42", state: "applied", checkedMs: 0 },
      { clientKey: "43", state: "applied", checkedMs: 0 },
    ]);
    const groupId = (await store.readDeviceGroups())[0]!.groupId;
    const { host, writes } = recordingHost();

    const reply = await routeApiRequest(
      store,
      `/api/clients/groups?group=${groupId}`,
      NOW,
      "DELETE",
      undefined,
      host,
    );
    expect(reply.body).toEqual({ removed: true });
    expect(await store.readMeterRules()).toEqual([]);

    await drain(store, host);

    expect(writes.map((write) => write.clientId).sort()).toEqual([42, 43]);
    expect(writes.every((write) => !write.paused)).toBe(true);
  });

  it("retires a deleted timer group's announcement once, not once per member", async () => {
    const store = await pairedStore();
    await saveGroup(store, { allocation: "0", countdown: String(3_600_000) });
    const groupId = (await store.readDeviceGroups())[0]!.groupId;
    const alertKey = `dataLimit:group:${groupId}`;
    await store.applyAlertTransitions(
      fired("system", alertKey, NOW.getTime() - 1_000),
      NOW.getTime(),
    );
    await store.writeMeterRules(
      (await store.readMeterRules()).map((rule) => ({
        ...rule,
        reachedAtMs: NOW.getTime() - 1_000,
      })),
    );
    // The store closes an episode that is already closed without complaint, so
    // what is counted here is the retires, not the episodes they land on.
    const retires: number[] = [];
    const record = store.applyAlertTransitions.bind(store);
    store.applyAlertTransitions = async (transitions, nowMs) => {
      retires.push(transitions.length);
      await record(transitions, nowMs);
    };

    await routeApiRequest(store, `/api/clients/groups?group=${groupId}`, NOW, "DELETE");

    // One clock ran out, not one per device, whether or not the members also
    // share an allowance.
    expect(retires).toEqual([1]);
    expect((await store.readAlerts(NOW.getTime())).find((e) => e.key === alertKey)?.endMs).toBe(
      NOW.getTime(),
    );
  });

  it("takes a member out of its group when its rule is deleted, so nothing puts it back", async () => {
    const store = await pairedStore();
    await saveGroup(store);

    await routeApiRequest(store, "/api/clients/meters?client=43", NOW, "DELETE");

    expect((await store.readDeviceGroups())[0]!.memberKeys).toEqual(["42"]);
    expect((await store.readMeterRules()).map((rule) => rule.clientKey)).toEqual(["42"]);
  });

  it("restarts one rule without touching another naming the same device", async () => {
    // A phone in a group's monthly allowance with a timer of its own beside it.
    // Restarting the timer must not hand back the month, on this device or on the
    // others sharing that group's allowance.
    const store = await pairedStore();
    await saveGroup(store);
    const groupId = (await store.readDeviceGroups())[0]!.groupId;
    const timer = new URLSearchParams({
      client: "42",
      allocation: "0",
      cycle: "once",
      countdown: "1800000",
    });
    const written = await routeApiRequest(store, `/api/clients/meters?${timer}`, NOW, "POST");
    expect(written.status).toBe(200);
    // Traffic on every rule, so a cycle that starts over is one that visibly
    // hands its usage back.
    await store.writeMeterRules(
      (await store.readMeterRules()).map((rule) => ({ ...rule, observedRx: rule.anchorRx + GB })),
    );
    const spent = async (clientKey: string, group: string | undefined) => {
      const rule = (await store.readMeterRules()).find(
        (other) => other.clientKey === clientKey && other.groupId === group,
      )!;
      return usageBytes(rule);
    };

    const later = new Date(NOW.getTime() + 86_400_000);
    await routeApiRequest(store, "/api/clients/meters/reset?client=42", later, "POST");

    // Only the device's own rule started over. This is the bug as it was seen: a
    // timer restarted on one phone handed back the month of every device sharing
    // its group.
    expect(await spent("42", undefined)).toBe(0);
    expect(await spent("42", groupId)).toBe(GB);
    expect(await spent("43", groupId)).toBe(GB);

    // Named by its group instead, every member starts over together.
    await routeApiRequest(store, `/api/clients/meters/reset?group=${groupId}`, later, "POST");

    expect(await spent("42", groupId)).toBe(0);
    expect(await spent("43", groupId)).toBe(0);
  });

  it("drops only a device's own rule when the write says so, as the desktop recorder does", async () => {
    const store = await pairedStore();
    await saveGroup(store);
    const terms = new URLSearchParams({ client: "43", allocation: "1000000000", cycle: "daily" });
    await routeApiRequest(store, `/api/clients/meters?${terms}`, NOW, "POST");

    await routeApiRequest(store, "/api/clients/meters?client=43&scope=own", NOW, "DELETE");

    // Its group still names it, and still keeps a rule for it.
    const held = (await store.readDeviceGroups())[0]!;
    expect(held.memberKeys).toEqual(["42", "43"]);
    const left = (await store.readMeterRules()).filter((rule) => rule.clientKey === "43");
    expect(left.map((rule) => rule.groupId)).toEqual([held.groupId]);
  });

  it("forgets a deleted device's rule and its membership, as the desktop recorder does", async () => {
    const store = await pairedStore();
    await saveGroup(store);

    await routeApiRequest(store, "/api/clients/totals?client=43", NOW, "DELETE");

    // A rule on a record that no longer exists can never be reached, and would
    // meter again unannounced if the device came back.
    expect((await store.readMeterRules()).map((rule) => rule.clientKey)).toEqual(["42"]);
    expect((await store.readDeviceGroups())[0]!.memberKeys).toEqual(["42"]);
  });

  it("holds a countdown on a cycle that cannot move its start", async () => {
    const store = await pairedStore();
    await saveGroup(store, { cycle: "daily", countdown: String(2 * 3_600_000) });
    const group = (await store.readDeviceGroups())[0]!;
    expect(group.cycle).toEqual({ kind: "once" });
    expect(group.countdownMs).toBe(2 * 3_600_000);
    // Or the projection would read the terms as changed on every drain.
    expect((await store.readMeterRules()).every((rule) => rule.countdownMs === 2 * 3_600_000)).toBe(
      true,
    );
  });

  it("caps a countdown at a day rather than taking it at its word", async () => {
    const store = await pairedStore();
    await saveGroup(store, { countdown: String(40 * 3_600_000) });
    expect((await store.readDeviceGroups())[0]!.countdownMs).toBe(24 * 3_600_000);
  });

  it("refuses a group naming no devices", async () => {
    const store = await pairedStore();
    expect((await saveGroup(store, { members: "" })).status).toBe(400);
  });

  it("takes a countdown group with no allowance behind it", async () => {
    const store = await pairedStore();
    expect((await saveGroup(store, { allocation: "0", countdown: "60000" })).status).toBe(200);
  });
});
