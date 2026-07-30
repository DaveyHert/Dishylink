// The alert store is the recording path, and it runs against a live setup where
// every alert is false — so nothing here can be confirmed by eye. These pin what
// the store itself owns: an episode spans one open to one close, a repeated open
// does not start a second, the two devices stay apart on a key they share, and
// the log survives a reload.
//
// Deciding *when* an episode opens is core/alertEngine's job and is pinned in
// core/alertEngine.test.ts. Nothing here should reason about device booleans.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertStore, type AlertEpisode } from "./alertStore.mts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `alertstore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "alerts.ndjson");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AlertStore episodes", () => {
  // Recent, so closed episodes stay inside the retention window.
  const now = Date.now();

  it("records an episode from its open to its close", () => {
    const store = new AlertStore(file);
    store.open("dish", "dishWaterDetected", now);
    expect(store.isOpen("dish", "dishWaterDetected")).toBe(true);
    expect(store.all().find((e) => e.key === "dishWaterDetected")).toMatchObject({
      source: "dish",
      startMs: now,
      endMs: null,
    });

    store.close("dish", "dishWaterDetected", now + 1_000);
    expect(store.isOpen("dish", "dishWaterDetected")).toBe(false);
    expect(store.all().find((e) => e.key === "dishWaterDetected")!.endMs).toBe(now + 1_000);
  });

  it("does not start a second episode while one is already open", () => {
    // The engine only reports an edge once, but a restart replays what it
    // restored — an episode already open must absorb that rather than fork.
    const store = new AlertStore(file);
    store.open("dish", "motorsStuck", 1_000);
    store.open("dish", "motorsStuck", 2_000);
    store.open("dish", "motorsStuck", 3_000);
    const open = store.all().filter((e) => e.key === "motorsStuck" && e.endMs === null);
    expect(open).toHaveLength(1);
    expect(open[0].startMs).toBe(1_000);
  });

  it("ignores a close for an episode that was never open", () => {
    const store = new AlertStore(file);
    store.close("dish", "motorsStuck", 1_000);
    expect(store.all()).toHaveLength(0);
  });

  it("keeps the dish and router apart on a key they share", () => {
    const store = new AlertStore(file);
    store.open("dish", "thermalThrottle", 1_000);
    store.open("router", "thermalThrottle", 1_000);

    // Closing the dish's must not touch the router's still-open episode.
    store.close("dish", "thermalThrottle", 2_000);
    expect(store.isOpen("dish", "thermalThrottle")).toBe(false);
    expect(store.isOpen("router", "thermalThrottle")).toBe(true);
  });

  it("survives a full open/close cycle across a reload from disk", () => {
    const first = new AlertStore(file);
    first.open("dish", "noEthernetLink", now);
    first.close("dish", "noEthernetLink", now + 2_000);

    expect(existsSync(file)).toBe(true);
    const reloaded = new AlertStore(file);
    expect(reloaded.all().find((e) => e.key === "noEthernetLink")).toMatchObject({
      source: "dish",
      startMs: now,
      endMs: now + 2_000,
    });
  });

  it("reports its open episodes so an engine can be restored from them", () => {
    const store = new AlertStore(file);
    store.open("dish", "dishWaterDetected", now);
    store.open("router", "poeFuseBlown", now);
    store.close("router", "poeFuseBlown", now + 1_000);

    const stillOpen = store
      .all()
      .filter((episode) => episode.endMs === null)
      .map((episode) => `${episode.source}:${episode.key}`);
    expect(stillOpen).toEqual(["dish:dishWaterDetected"]);
  });
});

describe("AlertStore retention", () => {
  // Seeded directly rather than via open/close: those call flush, which prunes
  // on the same cutoff, so an episode written already-old is gone before all()
  // is reached and the read filter goes untested. The case that matters is an
  // episode fresh when written that has since aged out with no write after it —
  // the normal state of a healthy dish, which raises nothing for weeks.
  function seedFile(episodes: AlertEpisode[]): void {
    writeFileSync(file, episodes.map((episode) => JSON.stringify(episode)).join("\n") + "\n");
  }

  const DAY_MS = 24 * 3_600_000;
  const closed = (startMs: number, endMs: number): AlertEpisode => ({
    source: "dish",
    key: "thermalThrottle",
    startMs,
    endMs,
  });

  it("serves a closed episode from inside the 48-hour window", () => {
    seedFile([closed(Date.now() - DAY_MS, Date.now() - DAY_MS + 1000)]);
    expect(new AlertStore(file).all()).toHaveLength(1);
  });

  it("hides a closed episode older than 48 hours, with nothing written since", () => {
    seedFile([closed(Date.now() - 3 * DAY_MS, Date.now() - 3 * DAY_MS + 1000)]);
    expect(new AlertStore(file).all()).toHaveLength(0);
  });

  it("keeps an open episode however old — it is current state, not history", () => {
    seedFile([
      { source: "dish", key: "dishWaterDetected", startMs: Date.now() - 30 * DAY_MS, endMs: null },
    ]);
    const served = new AlertStore(file).all();
    expect(served).toHaveLength(1);
    expect(served[0].endMs).toBeNull();
  });
});
