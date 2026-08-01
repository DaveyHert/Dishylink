import { describe, expect, it } from "vitest";
import { defaultStripPosition, formatMenuBarRate, formatSpacedRate } from "./menuBarThroughput";

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

describe("defaultStripPosition", () => {
  const size = { width: 108, height: 40 };

  it("rides a bottom taskbar, tucked left of the clock", () => {
    // 1920×1080 display, 48px bottom taskbar (work area 1032 tall).
    const pos = defaultStripPosition(
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
      size,
    );
    // Right edge minus the strip and the ~clock clearance.
    expect(pos.x).toBe(1920 - 108 - 180);
    // Centred in the 48px band that starts at y=1032: 1032 + (48-40)/2.
    expect(pos.y).toBe(1032 + 4);
  });

  it("rides a top taskbar in the top band", () => {
    const pos = defaultStripPosition(
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 48, width: 1920, height: 1032 } },
      size,
    );
    expect(pos.x).toBe(1920 - 108 - 180);
    expect(pos.y).toBe(4);
  });

  it("pins to the bottom-right when the taskbar is on a side (no horizontal band)", () => {
    // A left taskbar: work area is inset on x, full height — no top/bottom gap.
    const pos = defaultStripPosition(
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 72, y: 0, width: 1848, height: 1080 } },
      size,
    );
    expect(pos.x).toBe(72 + 1848 - 108 - 8);
    expect(pos.y).toBe(1080 - 40 - 8);
  });

  it("honours a non-zero display origin (secondary monitor)", () => {
    const pos = defaultStripPosition(
      { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1032 } },
      size,
    );
    expect(pos.x).toBe(-1920 + 1920 - 108 - 180);
    expect(pos.y).toBe(1032 + 4);
  });
});
