// Thermal episodes share the "Events & outages" panel with the event log, so
// they share its 24h window. These pin that the window is enforced on read —
// flush only runs when an episode opens or closes, so a quiet stretch or a
// restart would otherwise serve month-old episodes — and that an *open*
// episode survives the cutoff, because an unresolved throttle is current state.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThermalStore } from "./thermalStore.mts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `thermalstore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "thermal.ndjson");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HOUR_MS = 3_600_000;

describe("ThermalStore.all", () => {
  it("serves a closed episode from inside the 24h window", () => {
    const store = new ThermalStore(file);
    store.open("thermalThrottle", Date.now() - 3 * HOUR_MS);
    store.close("thermalThrottle", Date.now() - 2 * HOUR_MS);
    expect(store.all()).toHaveLength(1);
  });

  // Seeded directly rather than via open/close: those call flush, which prunes
  // on the same cutoff, so an episode written already-old is gone before all()
  // is reached and the read filter goes untested. What matters is an episode
  // that was fresh when written and has aged since, with no write after it.
  function seedFile(episodes: { alertKey: string; startMs: number; endMs: number | null }[]): void {
    writeFileSync(file, episodes.map((episode) => JSON.stringify(episode)).join("\n") + "\n");
  }

  it("hides a closed episode that aged out, with nothing written since", () => {
    seedFile([
      {
        alertKey: "thermalThrottle",
        startMs: Date.now() - 50 * HOUR_MS,
        endMs: Date.now() - 49 * HOUR_MS,
      },
    ]);
    expect(new ThermalStore(file).all()).toHaveLength(0);
  });

  it("keeps an open episode however old — it is current state, not history", () => {
    seedFile([{ alertKey: "thermalThrottle", startMs: Date.now() - 40 * HOUR_MS, endMs: null }]);
    const served = new ThermalStore(file).all();
    expect(served).toHaveLength(1);
    expect(served[0].endMs).toBeNull();
  });
});
