// The alert store is the recording path, and it runs against a live setup where
// every alert is false — so nothing here can be confirmed by eye. These pin the
// edge logic that the panel's History depends on: episodes open on a rising
// flag, close on a falling one, and — the subtle case — close when a key simply
// vanishes from the payload, because proto3 JSON omits false.

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

describe("AlertStore.ingest", () => {
  // Recent, so closed episodes stay inside the 7-day retention window.
  const now = Date.now();

  it("opens an episode on a rising flag and closes it on a falling one", () => {
    const store = new AlertStore(file);
    store.ingest("dish", { dishWaterDetected: true }, now);
    expect(store.isOpen("dish", "dishWaterDetected")).toBe(true);
    const open = store.all().find((e) => e.key === "dishWaterDetected")!;
    expect(open).toMatchObject({ source: "dish", startMs: now, endMs: null });

    store.ingest("dish", { dishWaterDetected: false }, now + 1_000);
    expect(store.isOpen("dish", "dishWaterDetected")).toBe(false);
    expect(store.all().find((e) => e.key === "dishWaterDetected")!.endMs).toBe(now + 1_000);
  });

  it("closes an open episode when the key vanishes from the payload (proto3 drops false)", () => {
    const store = new AlertStore(file);
    store.ingest("dish", { thermalThrottle: true }, now);
    expect(store.isOpen("dish", "thermalThrottle")).toBe(true);

    // The dish is healthy again: the whole alerts object comes back empty.
    store.ingest("dish", {}, now + 2_000);
    expect(store.isOpen("dish", "thermalThrottle")).toBe(false);
    expect(store.all()[0].endMs).toBe(now + 2_000);
  });

  it("does not duplicate an episode while a flag stays set", () => {
    const store = new AlertStore(file);
    store.ingest("dish", { motorsStuck: true }, 1_000);
    store.ingest("dish", { motorsStuck: true }, 2_000);
    store.ingest("dish", { motorsStuck: true }, 3_000);
    const open = store.all().filter((e) => e.key === "motorsStuck" && e.endMs === null);
    expect(open).toHaveLength(1);
    expect(open[0].startMs).toBe(1_000);
  });

  it("keeps the dish and router apart for an overlapping key like thermalThrottle", () => {
    const store = new AlertStore(file);
    store.ingest("dish", { thermalThrottle: true }, 1_000);
    store.ingest("router", { thermalThrottle: true }, 1_000);
    expect(store.isOpen("dish", "thermalThrottle")).toBe(true);
    expect(store.isOpen("router", "thermalThrottle")).toBe(true);

    // Clearing the dish must not touch the router's still-open episode.
    store.ingest("dish", {}, 2_000);
    expect(store.isOpen("dish", "thermalThrottle")).toBe(false);
    expect(store.isOpen("router", "thermalThrottle")).toBe(true);
  });

  it("leaves other sources untouched when one device is ingested", () => {
    const store = new AlertStore(file);
    store.ingest("router", { poeFuseBlown: true }, 1_000);
    // A dish poll arrives; the router's open episode must survive it.
    store.ingest("dish", { dishWaterDetected: true }, 1_500);
    expect(store.isOpen("router", "poeFuseBlown")).toBe(true);
    expect(store.isOpen("dish", "dishWaterDetected")).toBe(true);
  });

  it("survives a full open/close cycle across a reload from disk", () => {
    const first = new AlertStore(file);
    first.ingest("dish", { noEthernetLink: true }, now);
    first.ingest("dish", { noEthernetLink: false }, now + 2_000);

    expect(existsSync(file)).toBe(true);
    const reloaded = new AlertStore(file);
    const episode = reloaded.all().find((e) => e.key === "noEthernetLink")!;
    expect(episode).toMatchObject({ source: "dish", startMs: now, endMs: now + 2_000 });
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

  it("serves a closed episode from inside the 7-day window", () => {
    seedFile([closed(Date.now() - 6 * DAY_MS, Date.now() - 6 * DAY_MS + 1000)]);
    expect(new AlertStore(file).all()).toHaveLength(1);
  });

  it("hides a closed episode older than 7 days, with nothing written since", () => {
    seedFile([closed(Date.now() - 8 * DAY_MS, Date.now() - 8 * DAY_MS + 1000)]);
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
