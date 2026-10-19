import { describe, expect, it } from "vitest";
import { createI18n } from "@core/i18n/resources";
import { formatServiceClass } from "./serviceClass";

const { t } = createI18n("en");

describe("formatServiceClass", () => {
  it("separates roam from residential by mobility class", () => {
    expect(formatServiceClass("CONSUMER", "NOMADIC", t)).toBe("roam");
    expect(formatServiceClass("CONSUMER", "MOBILE", t)).toBe("roam");
    expect(formatServiceClass("CONSUMER", "STATIONARY", t)).toBe("residential");
    expect(formatServiceClass("CONSUMER", undefined, t)).toBe("residential");
  });

  it("names the business tiers", () => {
    expect(formatServiceClass("BUSINESS", undefined, t)).toBe("business");
    expect(formatServiceClass("BUSINESS_PLUS", undefined, t)).toBe("business plus");
  });

  it("keeps a business tier's name whatever the kit is licensed to do", () => {
    expect(formatServiceClass("BUSINESS", "MOBILE", t)).toBe("business");
  });

  it("falls back to the raw tier, and to a dash when there is none", () => {
    expect(formatServiceClass("SOME_NEW_TIER", undefined, t)).toBe("some new tier");
    expect(formatServiceClass(undefined, undefined, t)).toBe("—");
  });
});
