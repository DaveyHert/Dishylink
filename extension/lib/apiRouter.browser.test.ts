// The /api energy read end-to-end against real IndexedDB: a drained minute is
// persisted by the actual storage engine, then routeApiRequest reads it back and
// folds it. The in-memory unit test proves the routing; this proves the routing
// composed with real IndexedDB transactions and the readMinutes key range.

import { afterEach, describe, expect, it } from "vitest";
import type { TelemetrySample } from "@core/telemetry";
import type { DishWindow } from "@core/drain";
import { applyDrain, IndexedDbHistory } from "./history";
import { routeApiRequest } from "./apiRouter";

const MINUTE = 1_785_000_000;
// A now just past the drained minute, so the minute sits inside the 1h window.
const NOW = new Date((MINUTE + 60) * 1000);
let dbCounter = 0;
const openDatabases: string[] = [];

function window(count: number, powerW: number): DishWindow {
  const samples: TelemetrySample[] = Array.from({ length: count }, (_, second) => ({
    timestampMs: (MINUTE + second) * 1000,
    latencyMs: null,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  }));
  return { samples, newestCounter: count };
}

async function freshStoreName(): Promise<string> {
  const name = `api-router-test-${dbCounter++}`;
  openDatabases.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(
    openDatabases.splice(0).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  );
});

describe("routeApiRequest over real IndexedDB", () => {
  it("folds a drained minute into the /api/energy summary", async () => {
    const name = await freshStoreName();
    // 60 samples at 10 W = 600 watt-seconds recorded for the minute.
    await applyDrain(await IndexedDbHistory.open(name), window(60, 10));

    const reply = await routeApiRequest(
      await IndexedDbHistory.open(name),
      "/api/energy?range=1h",
      NOW,
    );

    expect(reply.status).toBe(200);
    const summary = reply.body as { totalKWh: number; range: string };
    expect(summary.range).toBe("1h");
    expect(summary.totalKWh).toBeCloseTo(600 / 3_600_000, 12);
  });

  it("reports zero from an empty store, not an error", async () => {
    const name = await freshStoreName();
    const reply = await routeApiRequest(
      await IndexedDbHistory.open(name),
      "/api/energy?range=1h",
      NOW,
    );
    expect(reply.status).toBe(200);
    expect((reply.body as { totalKWh: number }).totalKWh).toBe(0);
  });
});
