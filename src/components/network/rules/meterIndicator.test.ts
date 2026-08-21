// The mark a limited device wears in the network list and its drill-in.
//
// It reads the recorder's verdict rather than comparing the two figures beside
// it: a timer measures no bytes at all, and a member of a shared allowance is
// over when the group is, not when its own share is.

import { describe, expect, it } from "vitest";
import { meterIndicatorForRule } from "./meterIndicator";

describe("meterIndicatorForRule", () => {
  it("given: a pause this rule applied, should: read as held", () => {
    expect(
      meterIndicatorForRule({
        autoPause: true,
        reached: true,
        pauseState: "applied",
        holding: true,
      }),
    ).toBe("held");
  });

  it("given: a rule that reached its limit, should: read as reached", () => {
    expect(
      meterIndicatorForRule({ autoPause: true, reached: true, pauseState: "none", holding: true }),
    ).toBe("reached");
  });

  it("given: a timer that is up before the pause lands, should: read as reached", () => {
    // A countdown has spent no bytes, so anything comparing usage to the
    // allowance calls it "watching" for as long as the pause is in flight.
    expect(
      meterIndicatorForRule({
        autoPause: true,
        reached: true,
        pauseState: "pending",
        holding: true,
      }),
    ).toBe("reached");
  });

  it("given: a rule still within its limit, should: read as watching", () => {
    expect(
      meterIndicatorForRule({
        autoPause: true,
        reached: false,
        pauseState: "none",
        holding: false,
      }),
    ).toBe("watching");
  });

  it("given: a device paused by hand, should: not claim the block for this rule", () => {
    // The block belongs to the device whatever caused it. A rule nowhere near its
    // limit reading "held" puts a "Paused · limit" tag on a pause nobody metered.
    expect(
      meterIndicatorForRule({
        autoPause: true,
        reached: false,
        pauseState: "applied",
        holding: false,
      }),
    ).toBe("watching");
  });

  it("given: auto-pause off, should: read as off", () => {
    expect(
      meterIndicatorForRule({
        autoPause: false,
        reached: false,
        pauseState: "none",
        holding: false,
      }),
    ).toBe("off");
  });
});
