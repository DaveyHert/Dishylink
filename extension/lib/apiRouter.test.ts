import { describe, expect, it } from "vitest";
import { routeApiRequest } from "./apiRouter";
import { InMemoryHistory, type AlertSource } from "./history";
import type { AlertTransition } from "@core/alertEngine";
import { ClientTotalsCore } from "@core/clientTotals";
import type { EnergySummary } from "../../src/hooks/useEnergyHistory";

const NOW = new Date(1_600_000_000_000);
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
      [{ minute: 1_599_998_400, wattSeconds: 3_600_000, samples: 60, dlBits: 0, ulBits: 0 }],
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
      [{ minute: 1_599_998_400, wattSeconds: 0, samples: 60, dlBits: 8e9, ulBits: 0 }],
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
    const body = reply.body as { current: Array<{ tempC: number; dutyCycle: number }>; atMs: number };
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
        { minute, key: "42", macAddress: "aa", name: "Laptop", downMbps: 5, upMbps: 1, rxBytes: 100, txBytes: 20 },
        { minute: minute - 60, key: "7", macAddress: "bb", downMbps: 2, upMbps: 3, rxBytes: 50, txBytes: 10 },
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

  it("stores posted 1 Hz client samples that a since-tail read then returns", async () => {
    const store = new InMemoryHistory();
    const t = NOW.getTime();
    const body = JSON.stringify([{ key: "42", macAddress: "aa", atMs: t - 1_000, downMbps: 9, upMbps: 2 }]);
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
});
