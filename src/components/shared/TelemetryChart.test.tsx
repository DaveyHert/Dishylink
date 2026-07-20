// The chart shades outages as red bands. Router-log entries are point-in-time
// (power cycle, band switch: durationNs 0), and the band renderer floors every
// band at 2px — so a duration-less event would paint a critical-coloured
// hairline over a chart captioned "red bands = outages".

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { TelemetryChart } from "./TelemetryChart";
import { LATENCY_SERIES } from "../../lib/statDetails";
import type { OutageEvent, TelemetrySample } from "../../lib/telemetry";

const NOW = 1_784_400_000_000;

/** A flat minute of latency samples, one per second, ending now. */
function minuteOfSamples(): TelemetrySample[] {
  return Array.from({ length: 60 }, (_, index) => ({
    timestampMs: NOW - (59 - index) * 1000,
    latencyMs: 40,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 30,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  }));
}

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function outageBandCount(): number {
  return document.querySelectorAll('rect[fill="var(--status-critical)"]').length;
}

function renderWith(outageEvents: OutageEvent[]) {
  return render(
    <TelemetryChart
      samples={minuteOfSamples()}
      series={LATENCY_SERIES}
      windowMinutes={1}
      formatValue={(value) => `${value.toFixed(0)} ms`}
      outageEvents={outageEvents}
    />,
  );
}

describe("TelemetryChart outage bands", () => {
  test("shades an outage that occupies a stretch of time", async () => {
    renderWith([{ startMs: NOW - 30_000, durationMs: 8_000, cause: "OUTAGE_NO_PINGS", severity: "warning" }]);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (outageBandCount() > 0 ? true : null), "outage band");
    expect(outageBandCount()).toBe(1);
  });

  test("does not shade point-in-time router events", async () => {
    renderWith([
      { startMs: NOW - 30_000, durationMs: 0, cause: "EVENT_REASON_ROUTER_POWER_CYCLE", severity: "advisory" },
      { startMs: NOW - 20_000, durationMs: 0, cause: "EVENT_REASON_CLIENT_SWITCHING_BAND", severity: "advisory" },
    ]);
    await waitFor(() => document.querySelector("svg"), "chart");
    expect(outageBandCount()).toBe(0);
  });

  test("still shades the dish's own advisory outages, which do have duration", async () => {
    // "outage booting" is advisory but a real 38s gap — severity is not the
    // discriminator here, duration is.
    renderWith([{ startMs: NOW - 40_000, durationMs: 38_170, cause: "OUTAGE_BOOTING", severity: "advisory" }]);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (outageBandCount() > 0 ? true : null), "outage band");
    expect(outageBandCount()).toBe(1);
  });
});
