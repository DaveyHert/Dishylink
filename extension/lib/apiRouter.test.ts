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

  it("answers 503 for feeds the extension does not record yet", async () => {
    const reply = await routeApiRequest(new InMemoryHistory(), "/api/thermal", NOW);
    expect(reply.status).toBe(503);
  });
});
