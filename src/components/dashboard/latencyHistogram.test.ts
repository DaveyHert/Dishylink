// Bin math for the latency distribution: 2 ms bins, percentages, and an
// overflow bar that keeps every spike instead of dropping it off the axis.

import { describe, it, expect } from "vitest";
import { binLatencies, BIN_COUNT } from "../../lib/latencyBins";

describe("binLatencies", () => {
  it("returns all-zero bins for no samples rather than NaN", () => {
    const bins = binLatencies([]);
    expect(bins).toHaveLength(BIN_COUNT);
    expect(bins.every((pct) => pct === 0)).toBe(true);
  });

  it("bins by 2 ms and reports each bin as a percentage of all samples", () => {
    const bins = binLatencies([1, 1, 3, 250]);
    expect(bins[0]).toBe(50); // two of four land in [0, 2)
    expect(bins[1]).toBe(25); // one in [2, 4)
    expect(bins[BIN_COUNT - 1]).toBe(25); // ≥100 ms collects in the overflow bar
  });

  it("keeps every sample — the percentages sum to 100", () => {
    const bins = binLatencies([5, 17, 23, 99.9, 100, 400]);
    expect(bins.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100);
  });
});
