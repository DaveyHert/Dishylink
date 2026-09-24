import { describe, expect, it } from "vitest";
import { formatMenuBarRate, formatSpacedRate } from "./menuBarThroughput";

describe("formatMenuBarRate", () => {
  it("shows Kb/s below 1 Mbps, rounded to whole K", () => {
    expect(formatMenuBarRate(0)).toBe("0Kb/s");
    expect(formatMenuBarRate(340_000)).toBe("340Kb/s");
    // A quiet link rounds down to 0Kb/s rather than showing a bare number.
    expect(formatMenuBarRate(400)).toBe("0Kb/s");
    expect(formatMenuBarRate(49_400)).toBe("49Kb/s");
  });

  it("switches to Mb/s at exactly 1e6, one decimal", () => {
    // Boundary: 999_999 is still sub-Mbps, 1_000_000 is the first M.
    expect(formatMenuBarRate(999_999)).toBe("1000Kb/s");
    expect(formatMenuBarRate(1_000_000)).toBe("1.0Mb/s");
    expect(formatMenuBarRate(1_200_000)).toBe("1.2Mb/s");
    expect(formatMenuBarRate(23_500_000)).toBe("23.5Mb/s");
  });

  it("switches to Gb/s at exactly 1e9, one decimal", () => {
    expect(formatMenuBarRate(999_999_999)).toBe("1000.0Mb/s");
    expect(formatMenuBarRate(1_000_000_000)).toBe("1.0Gb/s");
    expect(formatMenuBarRate(2_400_000_000)).toBe("2.4Gb/s");
  });
});

describe("formatSpacedRate", () => {
  it("adds a single space before the unit at every scale", () => {
    expect(formatSpacedRate(0)).toBe("0 Kb/s");
    expect(formatSpacedRate(340_000)).toBe("340 Kb/s");
    expect(formatSpacedRate(1_200_000)).toBe("1.2 Mb/s");
    expect(formatSpacedRate(2_400_000_000)).toBe("2.4 Gb/s");
    // The sub-Mbps ceiling still reads in K, spaced.
    expect(formatSpacedRate(999_999)).toBe("1000 Kb/s");
  });
});

describe("byte rates", () => {
  it("divides by 8 before choosing the scale", () => {
    expect(formatMenuBarRate(0, "bytes")).toBe("0KB/s");
    // 8 Mb/s is 1 MB/s exactly — the first M in bytes.
    expect(formatMenuBarRate(8_000_000, "bytes")).toBe("1.0MB/s");
    // 1.2 Mb/s is 150 KB/s, still under the M threshold.
    expect(formatMenuBarRate(1_200_000, "bytes")).toBe("150KB/s");
    expect(formatMenuBarRate(188_000_000, "bytes")).toBe("23.5MB/s");
    expect(formatMenuBarRate(8_000_000_000, "bytes")).toBe("1.0GB/s");
  });

  it("spaces the byte unit too", () => {
    expect(formatSpacedRate(1_200_000, "bytes")).toBe("150 KB/s");
    expect(formatSpacedRate(188_000_000, "bytes")).toBe("23.5 MB/s");
  });
});
