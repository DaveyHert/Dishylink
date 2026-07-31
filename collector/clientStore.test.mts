// The per-minute tier behind the 6h per-device chart. The case that matters is
// devices sharing one masked MAC: the router reports a vendor OUI rather than a
// real MAC, so keyed by MAC a same-vendor group folded into a single row whose
// rate was the sum of the group, and every member drew that sum as its own line.

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientStore, type ClientReading } from "./clientStore.mts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `clientstore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "clients.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MINUTE_MS = 60_000;
const MAC = "60:74:f4:00:00:00";

function reading(key: string, downMbps: number, macAddress = MAC): ClientReading {
  return { key, macAddress, name: `dev-${key}`, downMbps, upMbps: 1, rxBytes: 0, txBytes: 0 };
}

/** A minute only closes — and is only written — when a later one opens. */
function closeMinute(store: ClientStore, atMs: number): void {
  store.ingest([], atMs + MINUTE_MS);
}

describe("ClientStore per-device keying", () => {
  it("keeps devices sharing one masked MAC apart, and never sums them", () => {
    const store = new ClientStore(file);
    const now = Date.now();
    store.ingest([reading("101", 2), reading("102", 5), reading("103", 11)], now);
    closeMinute(store, now);

    const rows = store.history(6);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.downMbps).sort((a, b) => a - b)).toEqual([2, 5, 11]);
    // The bug in one assertion: no row carries the group's total.
    expect(rows.map((row) => row.downMbps)).not.toContain(18);
    // All three still report the MAC they wear — it is identity that changed.
    expect(new Set(rows.map((row) => row.macAddress))).toEqual(new Set([MAC]));
  });

  it("filters to one device by key, not by the MAC its group shares", () => {
    const store = new ClientStore(file);
    const now = Date.now();
    store.ingest([reading("101", 2), reading("102", 5)], now);
    closeMinute(store, now);

    expect(store.history(6, "101").map((row) => row.downMbps)).toEqual([2]);
    expect(store.history(6, "102").map((row) => row.downMbps)).toEqual([5]);
  });

  it("averages and peaks within a device's own minute", () => {
    const store = new ClientStore(file);
    // Anchored inside a minute: the two samples are 1s apart, so a wall-clock
    // `now` landing near :59 would split them across the boundary and close only
    // the first — a flake, not the averaging this asserts.
    const now = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS + 1_000;
    store.ingest([reading("101", 2)], now);
    store.ingest([reading("101", 8)], now + 1_000);
    closeMinute(store, now);

    const [row] = store.history(6, "101");
    expect(row.downMbps).toBe(5);
    expect(row.downPeakMbps).toBe(8);
  });

  it("matches no device for a row written before per-device keying", () => {
    const store = new ClientStore(file);
    const now = Date.now();
    // `key` absent is what an old row looks like; attribution is the handler's.
    store.ingest(
      [{ macAddress: MAC, downMbps: 3, upMbps: 1, rxBytes: 0, txBytes: 0 } as ClientReading],
      now,
    );
    closeMinute(store, now);

    expect(store.history(6, "101")).toEqual([]);
  });
});
