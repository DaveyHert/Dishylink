// The extension's report path against the in-memory store: an outage episode
// closes on a drain, and the report is written from what the store holds, the
// same shape the desktop recorder writes and the router serves.

import { describe, expect, it } from "vitest";
import type { AlertTransition } from "@core/alertEngine";
import { SYSTEM_ALERTS } from "@core/alertDefinitions";
import type { TelemetrySample } from "@core/telemetry";
import { InMemoryHistory } from "./history";
import { recordOutageReports } from "./outageReports";
import { routeApiRequest } from "./apiRouter";

const NOW = 1_785_000_000_000;
const START = NOW - 180_000;
const WINDOW_START = START - 5 * 60_000;

function sample(timestampMs: number, dropRate = 0): TelemetrySample {
  return {
    timestampMs,
    latencyMs: 40,
    dropRate,
    downlinkBps: 100_000_000,
    uplinkBps: 10_000_000,
    powerW: 80,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  };
}

function transition(
  kind: "fired" | "cleared",
  key: "starlinkOutage" | "dishUnreachable",
  atMs: number,
): AlertTransition {
  return { kind, source: "system", key, atMs, spec: SYSTEM_ALERTS[key] };
}

async function storeWithOpenOutage(): Promise<InMemoryHistory> {
  const store = new InMemoryHistory();
  await store.applyAlertTransitions([transition("fired", "starlinkOutage", START)], START);
  await store.putSamples(
    Array.from({ length: 300 }, (_, second) => sample(WINDOW_START + second * 1000)),
    NOW,
  );
  await store.putOutages(
    [
      {
        startMs: START - 2_000,
        durationMs: 182_000,
        cause: "EVENT_REASON_OUTAGE_NO_PINGS",
        severity: "warning",
      },
    ],
    NOW,
  );
  return store;
}

describe("recordOutageReports", () => {
  it("writes a report when a link outage episode clears, and the router serves it", async () => {
    const store = await storeWithOpenOutage();
    const open = await store.readAlerts(NOW);
    const cleared = [transition("cleared", "starlinkOutage", NOW)];
    await store.applyAlertTransitions(cleared, NOW);

    expect(await recordOutageReports(store, open, cleared, NOW)).toBe(1);

    const reply = await routeApiRequest(store, "/api/outages/reports", new Date(NOW));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      reports: [
        {
          id: `system:starlinkOutage:${START}`,
          startMs: START,
          endMs: NOW,
          cause: "NO_PINGS",
          beforeDrop: { coverageSeconds: 300, latencyAvgMs: 40, source: "samples" },
        },
      ],
    });
  });

  it("writes nothing for a fired edge or for an alert that is not a link outage", async () => {
    const store = await storeWithOpenOutage();
    const open = await store.readAlerts(NOW);
    const written = await recordOutageReports(
      store,
      open,
      [
        transition("fired", "dishUnreachable", NOW),
        {
          kind: "cleared",
          source: "dish",
          key: "thermalThrottle",
          atMs: NOW,
          spec: SYSTEM_ALERTS.starlinkOutage,
        },
      ],
      NOW,
    );
    expect(written).toBe(0);
    expect(await store.readReports(NOW)).toEqual([]);
  });

  it("keeps the first report for an episode: a replayed close does not regenerate it", async () => {
    const store = await storeWithOpenOutage();
    const open = await store.readAlerts(NOW);
    const cleared = [transition("cleared", "starlinkOutage", NOW)];
    await recordOutageReports(store, open, cleared, NOW);
    await store.putSamples([sample(START - 1_000, 1)], NOW);
    await recordOutageReports(store, open, cleared, NOW + 30_000);

    const reports = await store.readReports(NOW + 30_000);
    expect(reports).toHaveLength(1);
    expect(reports[0].generatedAtMs).toBe(NOW);
  });

  it("drops reports older than thirty days on the next write", async () => {
    const store = new InMemoryHistory();
    const old = NOW - 31 * 24 * 3_600_000;
    await store.applyAlertTransitions([transition("fired", "dishUnreachable", old - 60_000)], old);
    const open = await store.readAlerts(old);
    const clearedOld = [transition("cleared", "dishUnreachable", old)];
    await store.applyAlertTransitions(clearedOld, old);
    await recordOutageReports(store, open, clearedOld, old);
    expect(await store.readReports(old)).toHaveLength(1);

    await store.applyAlertTransitions([transition("fired", "dishUnreachable", START)], START);
    const openNow = await store.readAlerts(NOW);
    await recordOutageReports(store, openNow, [transition("cleared", "dishUnreachable", NOW)], NOW);
    expect((await store.readReports(NOW)).map((report) => report.startMs)).toEqual([START]);
  });
});
