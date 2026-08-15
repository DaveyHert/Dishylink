import { describe, expect, it } from "vitest";
import { localMinutesToUtcMinutes, utcMinutesToLocalMinutes } from "./sleepSchedule";

describe("sleep schedule timezone conversion", () => {
  it("round-trips local minutes through UTC minutes unchanged", () => {
    // The pair has to be exactly inverse, or the saved hour drifts by the
    // machine's offset every time the modal is opened and saved again.
    for (const localMinutes of [0, 60, 450, 825, 1439]) {
      expect(utcMinutesToLocalMinutes(localMinutesToUtcMinutes(localMinutes))).toBe(localMinutes);
    }
  });

  it("stays inside a single day's worth of minutes", () => {
    for (const localMinutes of [0, 720, 1439]) {
      const utcMinutes = localMinutesToUtcMinutes(localMinutes);
      expect(utcMinutes).toBeGreaterThanOrEqual(0);
      expect(utcMinutes).toBeLessThan(24 * 60);
    }
  });

  it("moves by exactly one hour when the input does", () => {
    const first = localMinutesToUtcMinutes(4 * 60);
    const second = localMinutesToUtcMinutes(5 * 60);
    expect((second - first + 1440) % 1440).toBe(60);
  });
});
