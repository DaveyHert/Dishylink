import { describe, it, expect } from "vitest";
import { resolveRows, foldMinuteCollisions, type MinuteRow } from "./clientHistory";

const minute = (over: Partial<MinuteRow> & { key?: string; minute: number }): MinuteRow => ({
  macAddress: "60:74:f4:XX:XX:XX",
  downMbps: 0,
  upMbps: 0,
  downPeakMbps: 0,
  upPeakMbps: 0,
  ...over,
});

describe("resolveRows", () => {
  it("leaves a row whose key has no alias untouched, same object", () => {
    const rows = [minute({ key: "42", minute: 1 })];
    const out = resolveRows(rows, (r) => r.key);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(rows[0]); // no copy when the key does not move
    expect(out[0].key).toBe("42");
  });

  it("re-keys a row to the identity a merge moved it onto", () => {
    const alias = new Map([["13011248", "42"]]);
    const out = resolveRows(
      [minute({ key: "13011248", minute: 1 })],
      (r) => alias.get(r.key!) ?? r.key,
    );
    expect(out[0].key).toBe("42");
  });

  it("drops a row the resolver cannot claim (a shared-vendor legacy MAC)", () => {
    const out = resolveRows([minute({ key: undefined, minute: 1 })], () => undefined);
    expect(out).toEqual([]);
  });

  it("filters by device AFTER resolving, so a merged-away key still reaches its device", () => {
    const alias = new Map([["13011248", "42"]]);
    const rows = [
      minute({ key: "13011248", minute: 1, downMbps: 5 }),
      minute({ key: "42", minute: 2, downMbps: 8 }),
      minute({ key: "99", minute: 3, downMbps: 3 }),
    ];
    const out = resolveRows(rows, (r) => alias.get(r.key!) ?? r.key, "42");
    // The old-identity row is kept for device 42; the unrelated device is not.
    expect(out.map((r) => r.downMbps)).toEqual([5, 8]);
    expect(new Set(out.map((r) => r.key))).toEqual(new Set(["42"]));
  });
});

describe("foldMinuteCollisions", () => {
  it("rejoins two identities' partials of one minute: mean rate, max peak", () => {
    const out = foldMinuteCollisions([
      minute({ key: "42", minute: 10, downMbps: 4, upMbps: 1, downPeakMbps: 6, upPeakMbps: 2 }),
      minute({ key: "42", minute: 10, downMbps: 8, upMbps: 3, downPeakMbps: 5, upPeakMbps: 4 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].downMbps).toBe(6); // (4 + 8) / 2
    expect(out[0].upMbps).toBe(2); // (1 + 3) / 2
    expect(out[0].downPeakMbps).toBe(6); // max(6, 5)
    expect(out[0].upPeakMbps).toBe(4); // max(2, 4)
  });

  it("leaves distinct keys and minutes alone, sorted oldest first", () => {
    const out = foldMinuteCollisions([
      minute({ key: "42", minute: 20, downMbps: 8 }),
      minute({ key: "42", minute: 10, downMbps: 4 }),
      minute({ key: "99", minute: 10, downMbps: 1 }),
    ]);
    expect(out.map((r) => r.minute)).toEqual([10, 10, 20]);
    expect(out).toHaveLength(3);
  });

  it("averages every partial equally when more than two collide", () => {
    const out = foldMinuteCollisions([
      minute({ key: "42", minute: 10, downMbps: 3 }),
      minute({ key: "42", minute: 10, downMbps: 6 }),
      minute({ key: "42", minute: 10, downMbps: 9 }),
    ]);
    expect(out[0].downMbps).toBe(6); // (3 + 6 + 9) / 3, not a running pairwise mean
  });

  it("folds rows that carry no peak (the extension shape) without inventing one", () => {
    type NoPeak = {
      key: string;
      macAddress: string;
      minute: number;
      downMbps: number;
      upMbps: number;
    };
    const row = (downMbps: number): NoPeak => ({
      key: "42",
      macAddress: "60:74:f4:XX:XX:XX",
      minute: 10,
      downMbps,
      upMbps: 0,
    });
    const out = foldMinuteCollisions([row(4), row(8)]);
    expect(out[0].downMbps).toBe(6);
    expect("downPeakMbps" in out[0]).toBe(false);
  });

  it("keeps a peak that lands on a partial other than the newest", () => {
    // The guard keys off the folded value, not the last row: a peak on the older
    // partial survives even though the row supplying name/MAC has none.
    const out = foldMinuteCollisions([
      minute({ key: "42", minute: 10, downMbps: 4, downPeakMbps: 9 }),
      { key: "42", macAddress: "aa", minute: 10, downMbps: 8, upMbps: 0 } as MinuteRow,
    ]);
    expect(out[0].downMbps).toBe(6);
    expect(out[0].downPeakMbps).toBe(9);
  });
});
