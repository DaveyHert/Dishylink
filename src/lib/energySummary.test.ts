import { describe, expect, it } from "vitest";
import { energyRangeBounds, summarizeEnergy } from "@core/energySummary";
import type { MinuteBucket } from "@core/energyBuckets";

// A round epoch second; the "1h" range is UTC-based fixed 5-min bars, so every
// assertion below holds regardless of the machine's timezone.
const NOW = new Date(1_600_000_000_000);

function bucket(minute: number, over: Partial<MinuteBucket> = {}): MinuteBucket {
  return { minute, wattSeconds: 0, samples: 0, downlinkBits: 0, uplinkBits: 0, ...over };
}

describe("summarizeEnergy", () => {
  it("bounds the 1h range at now and one hour back", () => {
    expect(energyRangeBounds("1h", NOW)).toEqual({
      startSec: 1_599_996_400,
      endSec: 1_600_000_000,
    });
  });

  it("converts totals: watt-seconds → kWh and bits → GB", () => {
    const summary = summarizeEnergy(
      [
        bucket(1_599_998_400, {
          wattSeconds: 3_600_000,
          samples: 60,
          downlinkBits: 8e9,
          uplinkBits: 16e9,
        }),
      ],
      "1h",
      NOW,
    );
    expect(summary.totalKWh).toBe(1);
    expect(summary.totalDownGB).toBe(1);
    expect(summary.totalUpGB).toBe(2);
    // Coverage is honest: 60 sampled seconds out of the full hour, not padded.
    expect(summary.coverage.sampledSeconds).toBe(60);
    expect(summary.coverage.expectedSeconds).toBe(3600);
    expect(summary.coverage.fraction).toBeCloseTo(60 / 3600, 10);
    const nonNull = summary.buckets.filter((b) => b.kWh !== null);
    expect(nonNull).toHaveLength(1);
    expect(nonNull[0]!.kWh).toBe(1);
  });

  it("sums buckets sharing a 5-min slot, keeps distinct slots apart", () => {
    const summary = summarizeEnergy(
      [
        bucket(1_599_998_400, { wattSeconds: 1_800_000, samples: 60 }), // slot A
        bucket(1_599_998_460, { wattSeconds: 1_800_000, samples: 60 }), // slot A (same 300s bar)
        bucket(1_599_998_700, { wattSeconds: 900_000, samples: 30 }), // slot B
      ],
      "1h",
      NOW,
    );
    const nonNull = summary.buckets.filter((b) => b.kWh !== null);
    expect(nonNull).toHaveLength(2);
    expect(nonNull[0]!.kWh).toBe(1); // 3_600_000 Ws folded into one bar
    expect(nonNull[1]!.kWh).toBe(0.25);
    expect(summary.totalKWh).toBe(1.25);
  });

  it("emits every slot but marks unrecorded ones null, never zero", () => {
    const summary = summarizeEnergy([], "1h", NOW);
    expect(summary.totalKWh).toBe(0);
    expect(summary.coverage.sampledSeconds).toBe(0);
    expect(summary.buckets.length).toBeGreaterThan(0);
    expect(summary.buckets.every((b) => b.kWh === null)).toBe(true);
  });
});
