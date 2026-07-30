// The event store's retention window is a product decision, not an incidental
// constant: the log is a "what happened recently" panel covering overnight, and
// nothing in the UI reads events older than the 6H chart window. These pin the
// boundary and the dedup key so neither drifts back unnoticed.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore, type StoredEvent } from "./eventStore.mts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `eventstore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "events.ndjson");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HOUR_MS = 3_600_000;

function event(startMs: number, overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    startMs,
    durationMs: 800,
    cause: "EVENT_REASON_OUTAGE_NO_PINGS",
    severity: "warning",
    ...overrides,
  };
}

describe("EventStore retention", () => {
  it("keeps events from within the last 48 hours", () => {
    const store = new EventStore(file);
    store.upsert([event(Date.now() - 47 * HOUR_MS)]);
    expect(store.all()).toHaveLength(1);
  });

  it("drops events older than 48 hours on the next write", () => {
    const store = new EventStore(file);
    // The prune runs during flush, so it needs a write to trigger it — an old
    // event alone would sit there until something new arrives.
    store.upsert([event(Date.now() - 50 * HOUR_MS)]);
    store.upsert([event(Date.now(), { cause: "EVENT_REASON_OUTAGE_NO_DOWNLINK" })]);

    const remaining = store.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].cause).toBe("EVENT_REASON_OUTAGE_NO_DOWNLINK");
    // and the pruned row is gone from disk too, not just memory
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("EventStore.all enforces the window without a write", () => {
  // These must seed the file directly rather than upsert an already-old event:
  // upsert triggers flush, and flush prunes on the same cutoff, so writing an
  // old row prunes it immediately and proves nothing. The hole being pinned is
  // a row that was *fresh when written* and has since aged past the window with
  // no later write — which on disk looks exactly like this.
  function seedFile(rows: StoredEvent[]): void {
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  }

  it("hides an aged-out row when nothing has been written since", () => {
    seedFile([event(Date.now() - 50 * HOUR_MS)]);
    expect(new EventStore(file).all()).toHaveLength(0);
  });

  it("hides aged-out rows reloaded from disk, keeping the ones still in window", () => {
    seedFile([
      event(Date.now() - 50 * HOUR_MS),
      event(Date.now() - 2 * HOUR_MS, { cause: "RECENT" }),
    ]);

    const served = new EventStore(file).all();
    expect(served).toHaveLength(1);
    expect(served[0].cause).toBe("RECENT");
  });
});

describe("EventStore.upsert", () => {
  it("folds the same outage restated with a longer duration into one row", () => {
    const store = new EventStore(file);
    const startMs = Date.now();
    store.upsert([event(startMs, { durationMs: 800 })]);
    store.upsert([event(startMs, { durationMs: 2_400 })]);

    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0].durationMs).toBe(2_400);
  });

  it("folds the legacy humanized spelling into the raw enum's row", () => {
    const store = new EventStore(file);
    const startMs = Date.now();
    store.upsert([event(startMs, { cause: "outage no pings" })]);
    store.upsert([event(startMs, { cause: "EVENT_REASON_OUTAGE_NO_PINGS", durationMs: 900 })]);
    expect(store.all()).toHaveLength(1);
  });

  it("reports nothing changed for a repeat poll, so a quiet cycle costs no write", () => {
    const store = new EventStore(file);
    const rows = [event(Date.now())];
    expect(store.upsert(rows)).toBe(1);
    expect(store.upsert(rows)).toBe(0);
  });
});
