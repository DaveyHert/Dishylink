import { describe, expect, it } from "vitest";
import { solarAtmosphere } from "./solar";

describe("solar preview", () => {
  it("distinguishes local noon, twilight, and midnight at panel coordinates", () => {
    const at = (hour: string) => solarAtmosphere(0, 105, new Date(`2026-10-03T${hour}:00Z`));
    expect(at("05:00").elevation).toBeGreaterThan(70);
    expect(at("05:00").stars).toBe(false);
    expect(at("11:00").phase).toBe("Senja / fajar");
    expect(at("17:00").elevation).toBeLessThan(-60);
    expect(at("17:00").stars).toBe(true);
  });
  it("changes daylight with longitude at same instant", () => {
    const date = new Date("2026-03-20T12:00:00Z");
    expect(solarAtmosphere(0, 0, date).elevation).toBeGreaterThan(85);
    expect(solarAtmosphere(0, 180, date).elevation).toBeLessThan(-85);
  });
  it("handles polar summer and winter without sunrise events", () => {
    expect(solarAtmosphere(90, 0, new Date("2026-06-21T00:00:00Z")).phase).toBe("Siang");
    expect(solarAtmosphere(90, 0, new Date("2026-12-21T12:00:00Z")).phase).toBe("Malam");
  });
});
