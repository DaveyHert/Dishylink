import { describe, expect, it } from "vitest";
import { classifyDevice } from "./deviceKind";

describe("classifyDevice", () => {
  it("resolves single-word renames to the right kind", () => {
    expect(classifyDevice("TV")).toBe("tv");
    expect(classifyDevice("Console")).toBe("console");
    expect(classifyDevice("PS5")).toBe("console");
    expect(classifyDevice("PS4")).toBe("console");
    expect(classifyDevice("Xbox")).toBe("console");
    expect(classifyDevice("Phone")).toBe("phone");
    expect(classifyDevice("Android")).toBe("phone");
    expect(classifyDevice("iPhone")).toBe("phone");
  });

  it("reads real reported hostnames", () => {
    expect(classifyDevice("MacBook Pro M1")).toBe("laptop");
    expect(classifyDevice("iphone 15 Pro")).toBe("phone");
    expect(classifyDevice("Living Room TV")).toBe("tv");
    expect(classifyDevice("Galaxy Tab S8")).toBe("tablet");
    expect(classifyDevice("Apple Watch")).toBe("watch");
    expect(classifyDevice("Kids-iPad")).toBe("tablet");
  });

  it("does not confuse a substring for a whole word", () => {
    // "entertainment" contains "tv"? no — but guard against token false hits.
    expect(classifyDevice("Sony Interactive Entertainment")).toBe("unknown");
    expect(classifyDevice("Nanoleaf")).toBe("unknown");
  });

  it("does not let a hint fire inside an unrelated word", () => {
    expect(classifyDevice("Bose Headphones")).toBe("unknown");
    expect(classifyDevice("ASUS VivoBook")).toBe("unknown");
    // On a network panel a "Switch" is far more often a switch than a console.
    expect(classifyDevice("Netgear Switch")).toBe("unknown");
  });

  // The three above are fixed by narrowing the hint lists; these are what that
  // narrowing must not take with it. A run-together name has no word boundary to
  // tokenize on, so only the substring hint reaches it.
  it("still matches names that carry the hint without a word boundary", () => {
    expect(classifyDevice("iPhone15")).toBe("phone");
    expect(classifyDevice("Vivo X90")).toBe("phone");
    expect(classifyDevice("Nintendo Switch")).toBe("console");
  });

  it("reads a lamp/light/LED name as a light rather than what it sits near", () => {
    expect(classifyDevice("Lamp")).toBe("light");
    expect(classifyDevice("Living Room Light")).toBe("light");
    expect(classifyDevice("Bedroom LED")).toBe("light");
    // Carries "console" too — the lamp reading must win.
    expect(classifyDevice("Console Lamp")).toBe("light");
  });

  it("is 'unknown' when there is no type signal", () => {
    expect(classifyDevice(undefined)).toBe("unknown");
    expect(classifyDevice("")).toBe("unknown");
    expect(classifyDevice("5a:c9:44:00:00:00")).toBe("unknown");
  });
});
