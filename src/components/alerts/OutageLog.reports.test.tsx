// The post-mortem half of the outage card: ended outages list a report row, and
// the report opens as the shareable card with the JSON one button away. The
// report is frozen recorder output, so the card renders it verbatim — these pin
// what a user can copy out of it.

import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { OutageReport } from "@core/postmortem";
import { OutageLog } from "./OutageLog";
import { outageReportText } from "../../lib/outageReportText";

afterEach(cleanup);

const NOW = Date.now();

function report(overrides: Partial<OutageReport> = {}): OutageReport {
  return {
    id: `system:starlinkOutage:${NOW - 180_000}`,
    source: "starlinkOutage",
    startMs: NOW - 180_000,
    endMs: NOW,
    durationMs: 180_000,
    cause: "EVENT_REASON_OUTAGE_NO_PINGS",
    beforeDrop: {
      windowStartMs: NOW - 480_000,
      windowEndMs: NOW - 180_000,
      coverageSeconds: 300,
      latencyAvgMs: 40.5,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      dropRateAvg: 0.002,
      snowMelt: "unknown",
      source: "samples",
    },
    thermal: [{ alertKey: "thermalThrottle", startMs: NOW - 240_000, endMs: NOW - 120_000 }],
    generatedAtMs: NOW + 1_000,
    ...overrides,
  };
}

test("a report row opens the shareable card with the frozen figures", async () => {
  render(<OutageLog outageEvents={[]} reports={[report()]} />);

  // The report row is the only button until the modal opens.
  await page.getByRole("button", { name: /Ping Network Interruption/ }).click();
  await expect.poll(() => document.body.textContent ?? "").toContain("Outage report");

  const text = document.body.textContent ?? "";
  // The card states the cause through the plain-English label, and the
  // five-minutes-before figures verbatim.
  expect(text).toContain("Ping Network Interruption");
  expect(text).toContain("41 ms");
  expect(text).toContain("100.0 Mbps");
  expect(text).toContain("0.2%");
  expect(text).toContain("Snow melt");
  expect(text).toContain("Unknown");
  expect(text).toContain("Thermal throttling");
});

test("Copy JSON writes the report itself, not a summary", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(<OutageLog outageEvents={[]} reports={[report()]} />);
  await page.getByRole("button", { name: /Ping Network Interruption/ }).click();
  await page.getByRole("button", { name: "Copy JSON" }).click();

  expect(writeText).toHaveBeenCalledOnce();
  const written = JSON.parse(writeText.mock.calls[0][0] as string) as Record<string, unknown>;
  expect(written.id).toBe(`system:starlinkOutage:${NOW - 180_000}`);
  expect(written.beforeDrop).toMatchObject({
    coverageSeconds: 300,
    latencyAvgMs: 40.5,
    snowMelt: "unknown",
  });
  expect(written.thermal).toEqual([
    { alertKey: "thermalThrottle", startMs: NOW - 240_000, endMs: NOW - 120_000 },
  ]);
});

test("the text card reads like something to paste", () => {
  const text = outageReportText(report());
  expect(text).toContain("Dishylink outage report — Ping Network Interruption");
  expect(text).toContain("Latency: 41 ms");
  expect(text).toContain("Downlink: 100.0 Mbps");
  expect(text).toContain("Packet loss: 0.2%");
  expect(text).toContain("Snow melt: Unknown");
  expect(text).toContain("Thermal throttling:");
});

test("unknown figures are worded as not recorded, never invented", () => {
  const text = outageReportText(
    report({
      cause: null,
      beforeDrop: {
        windowStartMs: NOW - 480_000,
        windowEndMs: NOW - 180_000,
        coverageSeconds: 0,
        latencyAvgMs: null,
        downlinkAvgBps: null,
        uplinkAvgBps: null,
        dropRateAvg: null,
        snowMelt: "unknown",
        source: "minute-buckets",
      },
    }),
  );
  expect(text).toContain("Dishylink outage report — Link outage");
  expect(text).toContain("Latency: not recorded");
  expect(text).not.toContain("Packet loss");
  expect(text).toContain("Snow melt: Unknown");
});
