import { describe, expect, it } from "vitest";
import { SelfTrafficCorrection } from "./selfTrafficCorrection";

const T0 = 1_700_000_000_000;
const STEP_MS = 200;

function corrections(
  correction: SelfTrafficCorrection,
  readings: { raw: number; self: number }[],
): number[] {
  return readings.map(({ raw, self }, index) => {
    correction.record({ receivedBytes: self, sentBytes: 0 });
    return correction.apply({ rxBytes: raw, txBytes: 0 }, T0 + index * STEP_MS).rxBytes;
  });
}

describe("SelfTrafficCorrection", () => {
  it("passes the first reading through as the baseline", () => {
    const correction = new SelfTrafficCorrection();
    correction.record({ receivedBytes: 5_000, sentBytes: 5_000 });
    expect(correction.apply({ rxBytes: 900, txBytes: 400 }, T0)).toEqual({
      rxBytes: 900,
      txBytes: 400,
    });
  });

  it("subtracts its own traffic from the advance", () => {
    const correction = new SelfTrafficCorrection();
    const [, second] = corrections(correction, [
      { raw: 1_000, self: 0 },
      { raw: 2_000, self: 300 },
    ]);
    expect(second).toBe(1_700);
  });

  it("carries debt across polls where the counter did not move", () => {
    // The recorder polls ~5x per router refresh, so most polls read a counter
    // that has not stepped while its own traffic accrued. Flooring per poll
    // would discard four fifths of the correction.
    const correction = new SelfTrafficCorrection();
    const readings = [
      { raw: 1_000, self: 0 },
      { raw: 1_000, self: 200 },
      { raw: 1_000, self: 200 },
      { raw: 1_000, self: 200 },
      { raw: 1_000, self: 200 },
      { raw: 11_000, self: 200 },
    ];
    const result = corrections(correction, readings);
    expect(result.slice(1, 5)).toEqual([1_000, 1_000, 1_000, 1_000]);
    expect(result[5]).toBe(1_000 + 10_000 - 1_000);
  });

  it("never runs the corrected counter backwards on a forward reading", () => {
    const correction = new SelfTrafficCorrection();
    const result = corrections(correction, [
      { raw: 1_000, self: 0 },
      { raw: 1_100, self: 100_000 },
      { raw: 1_200, self: 0 },
    ]);
    expect(result[1]).toBe(1_000);
    expect(result[2]).toBe(1_000);
  });

  it("mirrors a counter reset so consumers still see one", () => {
    // A monotonic counter would hide re-association from throughputTracker,
    // which divides the whole post-reset value by one poll interval unless it
    // sees the counter go backwards.
    const correction = new SelfTrafficCorrection();
    const result = corrections(correction, [
      { raw: 5_000_000, self: 0 },
      { raw: 8_000_000, self: 0 },
      { raw: 4_000, self: 1_000 },
    ]);
    expect(result[1]).toBe(8_000_000);
    expect(result[2]).toBe(3_000);
    expect(result[2]).toBeLessThan(result[1]);
  });

  it("drops a reset the ceiling cannot vouch for, as clientTotals does", () => {
    const correction = new SelfTrafficCorrection();
    correction.record({ receivedBytes: 0, sentBytes: 0 });
    correction.apply({ rxBytes: 2_000_000_000, txBytes: 0 }, T0);
    correction.record({ receivedBytes: 0, sentBytes: 0 });
    // One millisecond on the fastest link this router serves cannot account for
    // a gigabyte, so the restarted counter is dropped rather than believed.
    expect(correction.apply({ rxBytes: 1_000_000_000, txBytes: 0 }, T0 + 1).rxBytes).toBe(0);
  });

  it("keeps receive and send debts apart", () => {
    const correction = new SelfTrafficCorrection();
    correction.record({ receivedBytes: 0, sentBytes: 0 });
    correction.apply({ rxBytes: 1_000, txBytes: 1_000 }, T0);
    correction.record({ receivedBytes: 500, sentBytes: 0 });
    expect(correction.apply({ rxBytes: 2_000, txBytes: 2_000 }, T0 + STEP_MS)).toEqual({
      rxBytes: 1_500,
      txBytes: 2_000,
    });
  });

  it("accumulates every call made between two polls", () => {
    const correction = new SelfTrafficCorrection();
    correction.record({ receivedBytes: 0, sentBytes: 0 });
    correction.apply({ rxBytes: 1_000, txBytes: 0 }, T0);
    correction.record({ receivedBytes: 100, sentBytes: 0 });
    correction.record({ receivedBytes: 150, sentBytes: 0 });
    correction.record({ receivedBytes: 250, sentBytes: 0 });
    expect(correction.apply({ rxBytes: 2_000, txBytes: 0 }, T0 + STEP_MS).rxBytes).toBe(1_500);
  });

  it("drops pending traffic no reading could carry", () => {
    // A recorder off the router's LAN, or one whose row the user has not named,
    // measures its own calls with nothing to charge them to. Held, the debt
    // would build for as long as that lasted and then take a bite out of real
    // traffic the moment the row appeared.
    const correction = new SelfTrafficCorrection();
    correction.record({ receivedBytes: 0, sentBytes: 0 });
    correction.apply({ rxBytes: 1_000, txBytes: 0 }, T0);
    correction.record({ receivedBytes: 900_000, sentBytes: 0 });
    correction.forgetPending();
    expect(correction.apply({ rxBytes: 2_000, txBytes: 0 }, T0 + STEP_MS).rxBytes).toBe(2_000);
  });

  it("resumes across a teardown without recharging what it already spent", () => {
    const first = new SelfTrafficCorrection();
    first.record({ receivedBytes: 0, sentBytes: 0 });
    first.apply({ rxBytes: 1_000, txBytes: 0 }, T0);
    first.record({ receivedBytes: 400, sentBytes: 0 });
    expect(first.apply({ rxBytes: 2_000, txBytes: 0 }, T0 + STEP_MS).rxBytes).toBe(1_600);

    const resumed = new SelfTrafficCorrection();
    resumed.loadSnapshot(first.toSnapshot());
    resumed.record({ receivedBytes: 100, sentBytes: 0 });
    expect(resumed.apply({ rxBytes: 3_000, txBytes: 0 }, T0 + 2 * STEP_MS).rxBytes).toBe(2_500);
  });

  it("spends each poll's measurement once", () => {
    const correction = new SelfTrafficCorrection();
    const result = corrections(correction, [
      { raw: 1_000, self: 0 },
      { raw: 2_000, self: 400 },
      { raw: 3_000, self: 0 },
    ]);
    expect(result[1]).toBe(1_600);
    expect(result[2]).toBe(2_600);
  });
});
