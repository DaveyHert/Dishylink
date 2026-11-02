// The dish's history is decoded afresh every second, so the events log only holds
// still if an unchanged decode is recognised as unchanged. These pin both halves:
// equal events must compare equal, and any real change must not be swallowed.

import { describe, it, expect } from "vitest";
import { sameOutageEvents, type OutageEvent } from "@core/telemetry";

const bandSwitch: OutageEvent = {
  startMs: 1_000,
  durationMs: 0,
  cause: "CLIENT_SWITCHING_BAND",
  severity: "advisory",
  bandSwitch: { clientId: 7, fromBand: "RF_2GHZ", toBand: "RF_5GHZ" },
};
const outage: OutageEvent = {
  startMs: 2_000,
  durationMs: 60_000,
  cause: "NO_DOWNLINK",
  severity: "critical",
};

describe("sameOutageEvents", () => {
  it("treats a fresh decode of the same events as unchanged", () => {
    const decoded = [bandSwitch, outage].map((event) => structuredClone(event));
    expect(sameOutageEvents([bandSwitch, outage], decoded)).toBe(true);
  });

  it("sees a new event", () => {
    expect(sameOutageEvents([outage], [bandSwitch, outage])).toBe(false);
  });

  it("sees an outage still growing", () => {
    expect(sameOutageEvents([outage], [{ ...outage, durationMs: 61_000 }])).toBe(false);
  });

  it("sees a band switch naming a different device or band", () => {
    const otherBand = {
      ...bandSwitch,
      bandSwitch: { ...bandSwitch.bandSwitch!, toBand: "RF_6GHZ" },
    };
    expect(sameOutageEvents([bandSwitch], [otherBand])).toBe(false);
  });

  it("sees the same events in a different order", () => {
    expect(sameOutageEvents([bandSwitch, outage], [outage, bandSwitch])).toBe(false);
  });
});
