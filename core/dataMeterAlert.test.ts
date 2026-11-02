// What a spent limit is announced as. Three hosts build this spec and history
// renders what was stored, so the key a device rule files under is a compatibility
// surface: change it and every episode already on disk orphans.

import { describe, expect, it } from "vitest";
import { dataLimitAlertSpec } from "./dataMeterAlert";
import type { MeterRule } from "./dataMeter";
import { createI18n } from "./i18n/resources";
import type { AlertSpec } from "./alertDefinitions";

const { t } = createI18n("en");
const firing = (spec: AlertSpec) => t(spec.firing, spec.vars);

const GB = 1_000_000_000;
const NOW = new Date(2026, 7, 12, 15, 30, 0).getTime();

function rule(over: Partial<MeterRule> = {}): MeterRule {
  return {
    clientKey: "42",
    allocationBytes: 50 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    anchorRx: 0,
    anchorTx: 0,
    observedRx: 0,
    observedTx: 0,
    periodStartMs: NOW,
    periodEndMs: NOW + 86_400_000,
    actedThisCycle: false,
    createdMs: NOW,
    ...over,
  };
}

describe("dataLimitAlertSpec", () => {
  it("given: a device rule, should: keep the key episodes are already filed under", () => {
    expect(dataLimitAlertSpec(rule(), "iPhone").key).toBe("dataLimit:42");
  });

  it("given: an allowance, should: name the figure it reached", () => {
    expect(firing(dataLimitAlertSpec(rule(), "iPhone"))).toBe(
      "iPhone reached its 50.0 GB data allowance",
    );
  });

  it("given: a countdown, should: name the timer rather than an allowance", () => {
    // A timer measures no bytes. The allowance on the rule is whatever the form
    // last carried, and quoting it describes a limit the timer never had.
    const spec = dataLimitAlertSpec(rule({ countdownMs: 5_400_000 }), "iPhone");
    expect(firing(spec)).toBe("iPhone reached the end of its 1h 30m timer");
    expect(firing(spec)).not.toMatch(/GB|TB|allowance/);
  });

  it("given: a shared allowance, should: file under the group and speak for all of it", () => {
    const spec = dataLimitAlertSpec(rule({ groupId: "kids", sharedAllowance: true }), "iPhone", {
      groupName: "Kids",
    });
    expect(spec.key).toBe("dataLimit:group:kids");
    expect(firing(spec)).toBe("Kids reached their 50.0 GB data allowance");
  });

  it("given: a group countdown, should: file under the group even without a shared allowance", () => {
    // Per-member is the card's default and the chooser is hidden while a timer is
    // set, so a group timer arrives unshared — and still ends once, not per device.
    const spec = dataLimitAlertSpec(rule({ groupId: "kids", countdownMs: 3_600_000 }), "iPhone", {
      groupName: "Kids",
    });
    expect(spec.key).toBe("dataLimit:group:kids");
    expect(firing(spec)).toBe("Kids reached the end of their 1h timer");
  });

  it("given: a group down to one device, should: name the device rather than a plural", () => {
    const spec = dataLimitAlertSpec(rule({ groupId: "kids", sharedAllowance: true }), "iPhone");
    // Still filed under the group, so it closes the episode the recorder opened.
    expect(spec.key).toBe("dataLimit:group:kids");
    expect(firing(spec)).toBe("iPhone reached its 50.0 GB data allowance");
  });
});
