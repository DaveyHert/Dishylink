import { describe, expect, it } from "vitest";
import { routeApiRequest } from "./apiRouter";
import { InMemoryHistory } from "./history";
import type { EnergySummary } from "../../src/hooks/useEnergyHistory";

const NOW = new Date(1_600_000_000_000);
const EMPTY_CURSOR = { counter: 0, newestSampleMs: 0 };

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
    await store.putOutages([
      { startMs: 1_000, durationMs: 5_000, cause: "NO_SCHEDULE", severity: "warning" },
      { startMs: 9_000, durationMs: 2_000, cause: "OBSTRUCTED", severity: "warning" },
    ]);
    // A re-seen episode (same startMs) updates rather than duplicates.
    await store.putOutages([
      { startMs: 1_000, durationMs: 7_000, cause: "NO_SCHEDULE", severity: "warning" },
    ]);

    const reply = await routeApiRequest(store, "/api/outages", NOW);

    expect(reply.status).toBe(200);
    const { events } = reply.body as { events: Array<{ startMs: number; durationMs: number }> };
    expect(events.map((e) => e.startMs)).toEqual([9_000, 1_000]);
    expect(events[1]!.durationMs).toBe(7_000);
  });

  it("averages radio temps per minute and keeps the lowest duty cycle", async () => {
    const store = new InMemoryHistory();
    const minuteMs = 1_785_000_000_000; // aligned to a minute for a clean bucket
    // Two readings in the same minute for one band: temp averages, duty floors.
    await store.putRadio([{ band: "RF_5GHZ", tempC: 60, dutyCycle: 100 }], minuteMs);
    await store.putRadio([{ band: "RF_5GHZ", tempC: 70, dutyCycle: 40 }], minuteMs + 5_000);

    const reply = await routeApiRequest(store, "/api/radio?hours=6", new Date(minuteMs + 10_000));

    expect(reply.status).toBe(200);
    const body = reply.body as {
      current: Array<{ tempC: number }>;
      history: Array<{ tempC: number; dutyCycle: number }>;
    };
    expect(body.current[0]!.tempC).toBe(70); // latest live reading
    expect(body.history).toHaveLength(1);
    expect(body.history[0]!.tempC).toBe(65); // (60 + 70) / 2
    expect(body.history[0]!.dutyCycle).toBe(40); // lowest, not averaged
  });

  it("answers 503 for feeds the extension does not record yet", async () => {
    const reply = await routeApiRequest(new InMemoryHistory(), "/api/thermal", NOW);
    expect(reply.status).toBe(503);
  });
});
