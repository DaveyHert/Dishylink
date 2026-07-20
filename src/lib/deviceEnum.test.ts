import { describe, expect, it } from "vitest";
import { formatActuatorState, formatAttitudeState, formatDeviceEnum } from "./format";

describe("formatDeviceEnum", () => {
  it("renders enums the way the official app does", () => {
    // Verified against the app's Alignment screen: FILTER_CONVERGED -> "Converged".
    expect(formatDeviceEnum("FILTER_CONVERGED", "FILTER_")).toBe("Converged");
    expect(formatDeviceEnum("ACTUATOR_STATE_IDLE", "ACTUATOR_STATE_")).toBe("Idle");
  });

  it("keeps multi-word tails readable rather than SHOUTING", () => {
    expect(formatDeviceEnum("ACTUATOR_STATE_TILT_TO_STOWED", "ACTUATOR_STATE_")).toBe(
      "Tilt to stowed",
    );
    expect(formatDeviceEnum("ACTUATOR_STATE_UNWRAP_POSITIVE", "ACTUATOR_STATE_")).toBe(
      "Unwrap positive",
    );
  });

  it("leaves a value alone when it does not carry the expected prefix", () => {
    // Firmware could introduce a differently-named value; better to show it raw
    // than to slice characters off the front of it.
    expect(formatDeviceEnum("SOMETHING_NEW", "FILTER_")).toBe("Something new");
  });

  it("returns null for an absent value so callers decide what silence means", () => {
    expect(formatDeviceEnum(undefined, "FILTER_")).toBeNull();
    expect(formatDeviceEnum("", "FILTER_")).toBeNull();
  });
});

describe("formatAttitudeState", () => {
  it("covers every state the dish's enum defines", () => {
    expect(formatAttitudeState("FILTER_CONVERGED")).toBe("Converged");
    expect(formatAttitudeState("FILTER_UNCONVERGED")).toBe("Unconverged");
    expect(formatAttitudeState("FILTER_RESET")).toBe("Reset");
    expect(formatAttitudeState("FILTER_FAULTED")).toBe("Faulted");
    expect(formatAttitudeState("FILTER_INVALID")).toBe("Invalid");
  });

  it("does NOT assume an absent value is the zero state", () => {
    // FILTER_RESET is 0, so proto3 omission could mean "reset" — but firmware
    // that never sends the field would then be reported as having reset, which
    // we have no evidence of. Unknown stays unknown.
    expect(formatAttitudeState(undefined)).toBeNull();
  });
});

describe("formatActuatorState", () => {
  it("reads an absent value as Idle, which is the zero value", () => {
    // Confirmed against hardware: our dish omits actuator_state entirely and the
    // official app shows "Idle" for it. Unlike the attitude filter, silence here
    // has a documented meaning.
    expect(formatActuatorState(undefined)).toBe("Idle");
  });

  it("names the motor states a mast-mounted kit reports", () => {
    expect(formatActuatorState("ACTUATOR_STATE_TILT")).toBe("Tilt");
    expect(formatActuatorState("ACTUATOR_STATE_FAULTED")).toBe("Faulted");
  });
});
