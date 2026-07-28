// The raw window is what makes the per-device chart dense from the moment it
// opens, so the cases that matter are the ones that quietly empty it: samples
// ageing out, a device that goes away and stops being written to, and a restart
// reading back a snapshot that has since gone stale.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientWindow, type ClientSample } from "./clientWindow.mts";
import type { ClientReading } from "./clientStore.mts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = join(tmpdir(), `clientwindow-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, "client-samples.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MINUTE_MS = 60_000;
const MAC = "aa:bb:cc:dd:ee:ff";

// `key` defaults to the MAC so the cases that predate per-device keying read the
// same; the same-MAC cases below pass it explicitly.
function reading(downMbps: number, macAddress = MAC, key = macAddress): ClientReading {
  return { key, macAddress, name: "laptop", downMbps, upMbps: 1, rxBytes: 0, txBytes: 0 };
}

describe("ClientWindow.ingest", () => {
  it("keeps one sample per poll, in order", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(1)], now - 2_000);
    window.ingest([reading(2)], now - 1_000);
    window.ingest([reading(3)], now);

    expect(window.samples(MAC).map((sample) => sample.downMbps)).toEqual([1, 2, 3]);
  });

  it("keeps devices apart", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(5, "aa:aa:aa:aa:aa:aa"), reading(9, "bb:bb:bb:bb:bb:bb")], now);

    expect(window.samples("aa:aa:aa:aa:aa:aa").map((s) => s.downMbps)).toEqual([5]);
    expect(window.samples("bb:bb:bb:bb:bb:bb").map((s) => s.downMbps)).toEqual([9]);
    expect(window.samples()).toHaveLength(2);
  });

  it("drops samples older than the 30-minute window", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(1)], now - 31 * MINUTE_MS);
    window.ingest([reading(2)], now - 29 * MINUTE_MS);
    window.ingest([reading(3)], now);

    expect(window.samples(MAC).map((sample) => sample.downMbps)).toEqual([2, 3]);
  });

  it("forgets a device that has stopped reporting, rather than holding its series forever", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    // Seen once, long ago, then never again — a device that left the network.
    window.ingest([reading(4, "dd:dd:dd:dd:dd:dd")], now - 31 * MINUTE_MS);
    // A later poll for a different device is what triggers the sweep.
    window.ingest([reading(7, MAC)], now);

    expect(window.samples("dd:dd:dd:dd:dd:dd")).toEqual([]);
    expect(window.samples(MAC)).toHaveLength(1);
  });

  // The router masks same-vendor MACs to one OUI, so this is three Govee bulbs on
  // a single MAC. Keyed by MAC they collapsed into one series carrying the sum,
  // and each bulb drew that sum as its own chart.
  it("keeps devices sharing one masked MAC apart, and never sums them", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(2, MAC, "101"), reading(5, MAC, "102"), reading(11, MAC, "103")], now);

    expect(window.samples("101").map((s) => s.downMbps)).toEqual([2]);
    expect(window.samples("102").map((s) => s.downMbps)).toEqual([5]);
    expect(window.samples("103").map((s) => s.downMbps)).toEqual([11]);
    // The bug in one assertion: nobody reports 18.
    expect(window.samples().map((s) => s.downMbps)).not.toContain(18);
  });

  // Samples restored from a snapshot written before keying carry no `key`. The
  // window keeps them under their MAC and hands them back unfiltered; deciding
  // which device may claim them needs `sharedMacs`, which lives in the odometer,
  // so it happens in the /api/clients handler and not here.
  it("keeps pre-keying samples under their MAC, for the caller to attribute", () => {
    const now = Date.now();
    writeFileSync(
      file,
      JSON.stringify([{ macAddress: MAC, atMs: now - 2_000, downMbps: 7, upMbps: 1 }]),
    );
    const window = new ClientWindow(file);
    window.ingest([reading(9, MAC, "101")], now);

    expect(window.samples("101").map((s) => s.downMbps)).toEqual([9]);
    expect(window.samples(MAC).map((s) => s.downMbps)).toEqual([7]);
    // The unfiltered call — the one the handler makes — sees both.
    expect(window.samples().map((s) => s.downMbps)).toEqual([7, 9]);
  });
});

// The incremental tail is what keeps a 1 Hz poller from re-downloading thirty
// minutes of history every second. Its whole contract is the `since` boundary:
// strictly newer, so a caller that reports the newest sample it holds is handed
// what it is missing and never a second copy of what it already has.
describe("ClientWindow.samples since", () => {
  it("returns only what is newer, so a tailing caller never re-reads its own samples", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(1)], now - 3_000);
    window.ingest([reading(2)], now - 2_000);
    window.ingest([reading(3)], now - 1_000);

    const held = window.samples(MAC);
    const newest = held[held.length - 1].atMs;
    // The caller holds everything up to `newest`; asking again must add nothing.
    expect(window.samples(MAC, newest)).toEqual([]);

    window.ingest([reading(4)], now);
    expect(window.samples(MAC, newest).map((sample) => sample.downMbps)).toEqual([4]);
  });

  it("excludes the boundary sample itself rather than resending it", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(1)], now - 1_000);
    window.ingest([reading(2)], now);

    expect(window.samples(MAC, now - 1_000).map((sample) => sample.downMbps)).toEqual([2]);
  });

  it("still honours the window cutoff when `since` reaches further back than it", () => {
    const window = new ClientWindow(file);
    const now = Date.now();
    window.ingest([reading(1)], now - 45 * MINUTE_MS);
    window.ingest([reading(2)], now);

    // since=0 is the first-load case: everything still live, nothing expired.
    expect(window.samples(MAC, 0).map((sample) => sample.downMbps)).toEqual([2]);
  });
});

describe("ClientWindow snapshot", () => {
  it("restores the window across a restart", () => {
    const first = new ClientWindow(file);
    first.ingest([reading(2)], Date.now() - 1_000);
    first.ingest([reading(3)], Date.now());
    first.snapshot();

    const reopened = new ClientWindow(file);
    expect(reopened.samples(MAC).map((sample) => sample.downMbps)).toEqual([2, 3]);
  });

  it("discards a snapshot whose samples have aged out while the historian was down", () => {
    const stale: ClientSample[] = [
      { macAddress: MAC, atMs: Date.now() - 45 * MINUTE_MS, downMbps: 8, upMbps: 1 },
    ];
    writeFileSync(file, JSON.stringify(stale));

    expect(new ClientWindow(file).samples(MAC)).toEqual([]);
  });

  it("starts empty rather than refusing to boot on a corrupt snapshot", () => {
    writeFileSync(file, "{ this is not json");
    expect(new ClientWindow(file).samples()).toEqual([]);
  });

  it("rounds to three decimals so the snapshot stays small", () => {
    const window = new ClientWindow(file);
    window.ingest([reading(1.23456789)], Date.now());
    window.snapshot();

    const persisted = JSON.parse(readFileSync(file, "utf8")) as ClientSample[];
    expect(persisted[0].downMbps).toBe(1.235);
  });
});
