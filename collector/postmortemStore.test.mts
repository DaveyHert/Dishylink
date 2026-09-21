// The post-mortem store pins one product decision and one invariant: a report
// outlives the 48 h events panel beside it (30-day window), and a report for an
// episode that has already been reported is never written twice — an episode
// closes once, so a second add for the same id is a regeneration bug.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostmortemStore } from "./postmortemStore.mts";
import type { OutageReport } from "../core/postmortem.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `postmortems-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "postmortems.ndjson");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HOUR_MS = 3_600_000;

function report(endMs: number, overrides: Partial<OutageReport> = {}): OutageReport {
  return {
    id: `system:starlinkOutage:${endMs - 60_000}`,
    source: "starlinkOutage",
    startMs: endMs - 60_000,
    endMs,
    durationMs: 60_000,
    cause: "NO_PINGS",
    beforeDrop: {
      windowStartMs: endMs - 366_000,
      windowEndMs: endMs - 60_000,
      coverageSeconds: 300,
      latencyAvgMs: 40,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      dropRateAvg: 0,
      snowMelt: "unknown",
      source: "samples",
    },
    thermal: [],
    generatedAtMs: endMs + 1_000,
    ...overrides,
  };
}

describe("PostmortemStore retention", () => {
  it("keeps reports from within the last 30 days", () => {
    const store = new PostmortemStore(file);
    store.add(report(Date.now() - 29 * 24 * HOUR_MS, { id: "A" }));
    expect(store.all()).toHaveLength(1);
  });

  it("drops reports older than 30 days on the next write", () => {
    const store = new PostmortemStore(file);
    store.add(report(Date.now() - 31 * 24 * HOUR_MS, { id: "old" }));
    store.add(report(Date.now(), { id: "new" }));

    const remaining = store.all();
    expect(remaining.map((row) => row.id)).toEqual(["new"]);
    // and the pruned row is gone from disk too, not just memory
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("hides an aged-out report when nothing has been written since", () => {
    // Seeded directly: add() flushes, and flush prunes on the same cutoff, so
    // writing an already-old report would prune it immediately and prove nothing.
    writeFileSync(file, JSON.stringify(report(Date.now() - 40 * 24 * HOUR_MS)) + "\n");
    expect(new PostmortemStore(file).all()).toHaveLength(0);
  });
});

describe("PostmortemStore.add", () => {
  it("serves reports newest-first, surviving a reopen", () => {
    const store = new PostmortemStore(file);
    store.add(report(Date.now() - 2 * 60_000, { id: "older" }));
    store.add(report(Date.now(), { id: "newer" }));

    const reopened = new PostmortemStore(file);
    expect(reopened.all().map((row) => row.id)).toEqual(["newer", "older"]);
  });

  it("refuses to regenerate a report for an episode already reported", () => {
    const store = new PostmortemStore(file);
    const row = report(Date.now());
    expect(store.add(row)).toBe(true);
    expect(store.add(row)).toBe(false);
    expect(store.all()).toHaveLength(1);
  });
});
