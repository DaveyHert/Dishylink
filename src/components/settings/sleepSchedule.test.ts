import { describe, expect, it } from "vitest";
import { localTimeToUtcMinutes, utcMinutesToLocalTime } from "./sleepSchedule";

describe("sleep schedule timezone conversion", () => {
  it("round-trips a local time through UTC minutes unchanged", () => {
    // The pair has to be exactly inverse, or the saved hour drifts by the
    // machine's offset every time the modal is opened and saved again.
    for (const localTime of ["00:00", "01:00", "07:30", "13:45", "23:59"]) {
      expect(utcMinutesToLocalTime(localTimeToUtcMinutes(localTime))).toBe(localTime);
    }
  });

  it("stays inside a single day's worth of minutes", () => {
    for (const localTime of ["00:00", "12:00", "23:59"]) {
      const utcMinutes = localTimeToUtcMinutes(localTime);
      expect(utcMinutes).toBeGreaterThanOrEqual(0);
      expect(utcMinutes).toBeLessThan(24 * 60);
    }
  });

  it("formats as zero-padded HH:MM", () => {
    expect(utcMinutesToLocalTime(localTimeToUtcMinutes("09:05"))).toMatch(/^\d{2}:\d{2}$/);
  });

  it("moves by exactly one hour when the input does", () => {
    const first = localTimeToUtcMinutes("04:00");
    const second = localTimeToUtcMinutes("05:00");
    expect((second - first + 1440) % 1440).toBe(60);
  });
});
