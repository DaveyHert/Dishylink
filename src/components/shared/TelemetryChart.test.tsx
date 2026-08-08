// The chart shades outages as red bands. Router-log entries are point-in-time
// (power cycle, band switch: durationNs 0), and the band renderer floors every
// band at 2px — so a duration-less event would paint a critical-coloured
// hairline over a chart captioned "red bands = outages".

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { TelemetryChart } from "./TelemetryChart";
import { windowTail } from "../../lib/telemetryWindow";
import { LATENCY_SERIES } from "../../lib/statDetails";
import type { OutageEvent, TelemetrySample } from "@core/telemetry";

// Real wall-clock, not a pinned constant: the chart's window ends at Date.now(),
// so a fixture dated to a fixed instant falls outside every window and renders
// nothing.
const NOW = Date.now();

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
    renderWith([
      { startMs: NOW - 30_000, durationMs: 8_000, cause: "OUTAGE_NO_PINGS", severity: "warning" },
    ]);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (outageBandCount() > 0 ? true : null), "outage band");
    expect(outageBandCount()).toBe(1);
  });

  test("does not shade point-in-time router events", async () => {
    renderWith([
      {
        startMs: NOW - 30_000,
        durationMs: 0,
        cause: "EVENT_REASON_ROUTER_POWER_CYCLE",
        severity: "advisory",
      },
      {
        startMs: NOW - 20_000,
        durationMs: 0,
        cause: "EVENT_REASON_CLIENT_SWITCHING_BAND",
        severity: "advisory",
      },
    ]);
    await waitFor(() => document.querySelector("svg"), "chart");
    expect(outageBandCount()).toBe(0);
  });

  test("still shades the dish's own advisory outages, which do have duration", async () => {
    // "outage booting" is advisory but a real 38s gap — severity is not the
    // discriminator here, duration is.
    renderWith([
      { startMs: NOW - 40_000, durationMs: 38_170, cause: "OUTAGE_BOOTING", severity: "advisory" },
    ]);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (outageBandCount() > 0 ? true : null), "outage band");
    expect(outageBandCount()).toBe(1);
  });
});

// windowTail is the one windowing function: the chart clips with it internally,
// and the stat panel's Average and energy figures slice with it, so a figure can
// never describe a different stretch than the chart beside it draws. It cuts by
// clock. Counting out windowMinutes × 60 samples looks equivalent — the buffer
// is nominally 1 Hz — and holds right up until a recording gap, at which point
// it reaches back through the gap for the shortfall and silently returns hours.
describe("windowTail", () => {
  /** `count` samples at 1 Hz ending `endMs`, oldest first. */
  function run(endMs: number, count: number): TelemetrySample[] {
    return Array.from({ length: count }, (_, index) => ({
      ...minuteOfSamples()[0],
      timestampMs: endMs - (count - 1 - index) * 1000,
    }));
  }

  test("keeps exactly the window when the stream is unbroken", () => {
    const tail = windowTail(run(NOW, 3600), 15, NOW);
    expect(tail).toHaveLength(901);
    expect(NOW - tail[0].timestampMs).toBe(15 * 60_000);
  });

  test("does not reach past the window across a recording gap", () => {
    // 20 minutes recorded, then 5 hours of nothing, then 20 minutes recorded.
    // A count-based slice of 3600 would take all 2400 samples and span 5h40m.
    const gapEndMs = NOW - 20 * 60_000;
    const samples = [...run(gapEndMs - 5 * 3_600_000, 1200), ...run(NOW, 1200)];

    const tail = windowTail(samples, 60, NOW);

    const spanMinutes = (NOW - tail[0].timestampMs) / 60_000;
    expect(spanMinutes).toBeLessThanOrEqual(60);
  });

  test("returns everything it has when the buffer is shorter than the window", () => {
    const samples = run(NOW, 300);
    expect(windowTail(samples, 60, NOW)).toHaveLength(300);
  });

  // The window ends at wall-clock now, so a dish that stopped answering an hour
  // ago leaves it empty rather than sliding it back to the last hour with data.
  test("returns nothing once every sample has aged out of the window", () => {
    const stale = run(NOW - 2 * 3_600_000, 300);
    expect(windowTail(stale, 60, NOW)).toEqual([]);
  });

  test("keeps only the part of a stale buffer still inside the window", () => {
    // Recording stopped 30 minutes ago after running for an hour: half the
    // window holds data, half is the outage that is still going on.
    const samples = run(NOW - 30 * 60_000, 3600);
    const tail = windowTail(samples, 60, NOW);
    expect(tail).toHaveLength(1801);
    expect(NOW - tail[0].timestampMs).toBe(60 * 60_000);
    expect(NOW - tail[tail.length - 1].timestampMs).toBe(30 * 60_000);
  });
});

// A gap at the right edge is the outage that is still going on, and it is only
// visible because the window ends at wall-clock now. Were the window anchored to
// the newest sample instead, that sample would define the right edge and the
// missing stretch would never be on screen to shade.
describe("TelemetryChart trailing gap", () => {
  function noDataBandCount(): number {
    return document.querySelectorAll('rect[fill="var(--ink-muted)"]').length;
  }

  function renderStale(minutesSinceLastSample: number) {
    const endMs = Date.now() - minutesSinceLastSample * 60_000;
    const samples = Array.from({ length: 300 }, (_, index) => ({
      ...minuteOfSamples()[0],
      timestampMs: endMs - (299 - index) * 1000,
    }));
    return render(
      <TelemetryChart
        samples={samples}
        series={LATENCY_SERIES}
        windowMinutes={15}
        formatValue={(value) => `${value.toFixed(0)} ms`}
      />,
    );
  }

  test("shades the stretch since readings stopped", async () => {
    renderStale(5);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (noDataBandCount() > 0 ? true : null), "no-data band");
    expect(noDataBandCount()).toBeGreaterThan(0);
  });

  test("shades the whole window when nothing in it was recorded", async () => {
    renderStale(60);
    await waitFor(() => document.querySelector("svg"), "chart");
    await waitFor(() => (noDataBandCount() > 0 ? true : null), "no-data band");
    // No line to draw, and the window is entirely unmeasured: one band, not none.
    expect(noDataBandCount()).toBe(1);
  });
});
