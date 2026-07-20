import { describe, expect, it } from "vitest";
import { UPDATE_WINDOWS, updateWindowFor } from "./updateWindow";

describe("UPDATE_WINDOWS", () => {
  it("offers the same four the official app does", () => {
    expect(UPDATE_WINDOWS.map((w) => w.hour)).toEqual([3, 9, 15, 21]);
  });

  it("tiles the whole day with no gap or overlap", () => {
    // Every hour must land in exactly one window, or a dish value could select
    // nothing and the control would render blank.
    for (let hour = 0; hour < 24; hour++) {
      const matching = UPDATE_WINDOWS.filter((w) => hour >= w.startHour && hour < w.endHour);
      expect(matching).toHaveLength(1);
    }
  });

  it("puts each representative hour inside its own window", () => {
    for (const window of UPDATE_WINDOWS) {
      expect(window.hour).toBeGreaterThanOrEqual(window.startHour);
      expect(window.hour).toBeLessThan(window.endHour);
    }
  });
});

describe("updateWindowFor", () => {
  it("maps the dish's real value to the window the app shows selected", () => {
    // The live dish reports 3, and the app shows "Overnight" selected.
    expect(updateWindowFor(3).label).toBe("Overnight, around 3 AM");
  });

  it("selects each window from its own representative hour", () => {
    expect(updateWindowFor(9).hour).toBe(9);
    expect(updateWindowFor(15).hour).toBe(15);
    expect(updateWindowFor(21).hour).toBe(21);
  });

  it("folds an off-grid hour into the window that contains it", () => {
    // An hour an older client may have written: 7 is inside 6 AM–12 PM.
    expect(updateWindowFor(7).hour).toBe(9);
    expect(updateWindowFor(0).hour).toBe(3);
    expect(updateWindowFor(23).hour).toBe(21);
  });

  it("defaults to overnight when the dish reports nothing", () => {
    // proto3 omits the field when unset, matching the dish's own default.
    expect(updateWindowFor(undefined).hour).toBe(3);
  });

  it("never returns undefined for an out-of-range value", () => {
    for (const hour of [-1, 24, 48, 100]) {
      expect(updateWindowFor(hour)).toBeDefined();
    }
  });
});
