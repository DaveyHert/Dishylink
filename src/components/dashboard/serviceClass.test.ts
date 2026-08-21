import { describe, expect, it } from "vitest";
import { formatServiceClass } from "./serviceClass";

describe("formatServiceClass", () => {
  it("separates roam from residential by mobility class", () => {
    expect(formatServiceClass("CONSUMER", "NOMADIC")).toBe("roam");
    expect(formatServiceClass("CONSUMER", "MOBILE")).toBe("roam");
    expect(formatServiceClass("CONSUMER", "STATIONARY")).toBe("residential");
    expect(formatServiceClass("CONSUMER", undefined)).toBe("residential");
  });

  it("names the business tiers", () => {
    expect(formatServiceClass("BUSINESS")).toBe("business");
    expect(formatServiceClass("BUSINESS_PLUS")).toBe("business plus");
  });

  it("keeps a business tier's name whatever the kit is licensed to do", () => {
    expect(formatServiceClass("BUSINESS", "MOBILE")).toBe("business");
  });

  it("falls back to the raw tier, and to a dash when there is none", () => {
    expect(formatServiceClass("SOME_NEW_TIER")).toBe("some new tier");
    expect(formatServiceClass(undefined)).toBe("—");
  });
});
