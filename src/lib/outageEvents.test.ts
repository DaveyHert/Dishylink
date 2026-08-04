import { describe, expect, it } from "vitest";
import { canonicalCause, outageEventKind, outageEventMeta } from "@core/telemetry";
import { formatEventDuration } from "./format";

describe("canonicalCause", () => {
  it("reduces raw enum, legacy humanized label, and outage-cause spelling to one token", () => {
    // The exact trio that produced the duplicate row: same event, three spellings.
    expect(canonicalCause("EVENT_REASON_UT_ALERT_RAIN_SNR_PERSISTENTLY_LOW")).toBe(
      "RAIN_SNR_PERSISTENTLY_LOW",
    );
    expect(canonicalCause("ut alert rain snr persistently low")).toBe("RAIN_SNR_PERSISTENTLY_LOW");
    expect(canonicalCause("EVENT_REASON_OUTAGE_NO_PINGS")).toBe("NO_PINGS");
    expect(canonicalCause("NO_PINGS")).toBe("NO_PINGS");
  });
});

describe("outageEventMeta", () => {
  it("gives distinct app-facing labels (not collapsed) with a tooltip", () => {
    expect(outageEventMeta("EVENT_REASON_OUTAGE_NO_PINGS").label).toBe("Ping Network Interruption");
    expect(outageEventMeta("EVENT_REASON_OUTAGE_NO_DOWNLINK").label).toBe(
      "Downlink Network Interruption",
    );
    expect(outageEventMeta("OBSTRUCTED").label).toBe("Dish's view obstructed");
    expect(outageEventMeta("OBSTRUCTED").tip).toContain("blocked the dish's view");
  });

  it("resolves a legacy persisted label to the same meaning", () => {
    expect(outageEventMeta("ut alert rain snr persistently low").label).toBe(
      "Weather interference",
    );
  });

  it("names the router (wifi_get_history) events, auto-cleaning the long tail", () => {
    expect(outageEventMeta("EVENT_REASON_ROUTER_POWER_CYCLE").label).toBe("Router powered on");
    expect(outageEventMeta("EVENT_REASON_CLIENT_SWITCHING_BAND").label).toBe(
      "Device switched WiFi band",
    );
    // Unmapped router reasons still read cleanly via the sentence-case fallback.
    expect(outageEventMeta("EVENT_REASON_ROUTER_SOFTWARE_UPDATE").label).toBe(
      "Router software update",
    );
  });

  it("never leaks a raw enum or 'Outage' prefix; unknown enums sentence-case", () => {
    const label = outageEventMeta("EVENT_REASON_OUTAGE_SOME_FUTURE_CAUSE").label;
    expect(label).not.toMatch(/_|EVENT_REASON|^OUTAGE|^Outage /);
    expect(label).toBe("Some future cause");
  });

  it("passes an already-human label (thermal episode) through untouched", () => {
    expect(outageEventMeta("Thermal throttle (ongoing)").label).toBe("Thermal throttle (ongoing)");
  });
});

describe("outageEventKind", () => {
  // The tokens below are the ones this dish and router actually logged; the
  // router's keepalive drops ran 30–90s each and were banding the charts red
  // while the throughput line underneath showed traffic flowing throughout.
  it("counts only a real loss of service as an outage", () => {
    expect(outageEventKind("EVENT_REASON_OUTAGE_NO_PINGS")).toBe("outage");
    expect(outageEventKind("EVENT_REASON_OUTAGE_NO_DOWNLINK")).toBe("outage");
    expect(outageEventKind("EVENT_REASON_OUTAGE_BOOTING")).toBe("outage");
    expect(outageEventKind("OBSTRUCTED")).toBe("outage");
    expect(outageEventKind("EVENT_REASON_ETH_NO_LINK")).toBe("outage");
  });

  it("calls the router's keepalive and packet-loss events degraded, not outages", () => {
    expect(outageEventKind("EVENT_REASON_ROUTER_POP_IPV4_PING_DROP")).toBe("degraded");
    expect(outageEventKind("EVENT_REASON_ROUTER_POP_IPV6_PING_DROP")).toBe("degraded");
    expect(outageEventKind("EVENT_REASON_ROUTER_DISH_PING_DROP")).toBe("degraded");
    expect(outageEventKind("EVENT_REASON_HIGH_DOWNLINK_PACKET_LOSS")).toBe("degraded");
  });

  it("treats point-in-time router chatter as information", () => {
    expect(outageEventKind("EVENT_REASON_CLIENT_SWITCHING_BAND")).toBe("info");
    expect(outageEventKind("EVENT_REASON_CLIENT_SWITCHING_UPSTREAM_MAC")).toBe("info");
    expect(outageEventKind("EVENT_REASON_ROUTER_POWER_CYCLE")).toBe("info");
    expect(outageEventKind("EVENT_REASON_ROUTER_PUBLIC_IPV4_CHANGE")).toBe("info");
  });

  it("defaults an unknown token to info, so only OUTAGE_* can claim an outage", () => {
    // A firmware update adding a reason must not paint red bands on sight.
    expect(outageEventKind("EVENT_REASON_ROUTER_SOFTWARE_UPDATE")).toBe("info");
    expect(outageEventKind("EVENT_REASON_SOME_FUTURE_THING")).toBe("info");
    // …but one the firmware itself namespaces as an outage is taken at its word.
    expect(outageEventKind("EVENT_REASON_OUTAGE_SOME_FUTURE_CAUSE")).toBe("outage");
  });

  it("gives the thermal episodes' human labels a kind rather than undefined", () => {
    expect(outageEventKind("Thermal throttle (ongoing)")).toBe("info");
    expect(outageEventKind("")).toBe("info");
  });
});

describe("formatEventDuration", () => {
  it("shows whole seconds with no ms, rounding a sub-second blip up to 1s", () => {
    expect(formatEventDuration(779)).toBe("1s");
    expect(formatEventDuration(2100)).toBe("2s");
    expect(formatEventDuration(61_000)).toBe("1m 1s");
    expect(formatEventDuration(1_092_000)).toBe("18m 12s");
    expect(formatEventDuration(3_600_000)).toBe("1h");
  });

  it("shows nothing for a point-in-time event, rather than inventing a 1s length", () => {
    // The router logs power cycles and band switches with durationNs: 0.
    expect(formatEventDuration(0)).toBe("");
  });
});
