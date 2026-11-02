// The router's band-switch events carry which device moved between which bands.
// The event below follows a real wifi_get_history reply, trimmed to the fields
// that matter here.

import { describe, expect, it } from "vitest";
import { decodeWifiHistoryEvents } from "./telemetry";

function routerEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: "EVENT_SEVERITY_ADVISORY",
    reason: "EVENT_REASON_CLIENT_SWITCHING_BAND",
    startTimestampNs: "1792381044961377998",
    deviceId: "3858703521",
    clientSwitchingBandMetadata: {
      clientId: 3858703521,
      fromBand: "RF_2GHZ",
      toBand: "RF_5GHZ_HIGH",
    },
    ...overrides,
  };
}

describe("decodeWifiHistoryEvents band switches", () => {
  it("keeps the device and both bands", () => {
    const [event] = decodeWifiHistoryEvents({ eventLog: { events: [routerEvent()] } });
    expect(event).toMatchObject({
      startMs: 1792381044961,
      durationMs: 0,
      cause: "EVENT_REASON_CLIENT_SWITCHING_BAND",
      severity: "advisory",
      bandSwitch: { clientId: 3858703521, fromBand: "RF_2GHZ", toBand: "RF_5GHZ_HIGH" },
    });
  });

  it("leaves the details off when the router omits a band", () => {
    const [event] = decodeWifiHistoryEvents({
      eventLog: {
        events: [
          routerEvent({ clientSwitchingBandMetadata: { clientId: 7, fromBand: "RF_2GHZ" } }),
        ],
      },
    });
    expect(event.bandSwitch).toBeUndefined();
  });

  it("adds nothing to an event that is not a band switch", () => {
    const [event] = decodeWifiHistoryEvents({
      eventLog: {
        events: [
          routerEvent({
            reason: "EVENT_REASON_ROUTER_POWER_CYCLE",
            clientSwitchingBandMetadata: undefined,
          }),
        ],
      },
    });
    expect(event).not.toHaveProperty("bandSwitch");
  });
});
