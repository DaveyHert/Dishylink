import { describe, expect, it } from "vitest";
import { timeLocale, uses24HourClock } from "./timeFormat";

const afternoon = new Date(2026, 9, 19, 14, 57);
const shortTime = (locale: string) =>
  afternoon.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

describe("time format", () => {
  it("leaves the language's own clock alone on Automatic", () => {
    expect(shortTime(timeLocale("en", "auto"))).toMatch(/^2:57\s?PM$/);
    expect(shortTime(timeLocale("de", "auto"))).toBe("14:57");
  });

  it("forces a 24-hour clock in a 12-hour language", () => {
    expect(shortTime(timeLocale("en", "24h"))).toBe("14:57");
    expect(uses24HourClock("en", "24h")).toBe(true);
  });

  it("forces a 12-hour clock in a 24-hour language", () => {
    expect(shortTime(timeLocale("fr", "12h"))).toMatch(/^2:57\s?PM$/);
    expect(uses24HourClock("fr", "12h")).toBe(false);
  });

  it("changes times only, never dates", () => {
    const date = (locale: string) =>
      afternoon.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
    for (const language of ["en", "de", "es", "fr", "pt"]) {
      expect(date(timeLocale(language, "12h"))).toBe(date(language));
      expect(date(timeLocale(language, "24h"))).toBe(date(language));
    }
  });

  it("reads each language's own clock on Automatic", () => {
    expect(uses24HourClock("en", "auto")).toBe(false);
    for (const language of ["de", "es", "fr", "pt"]) {
      expect(uses24HourClock(language, "auto")).toBe(true);
    }
  });
});
