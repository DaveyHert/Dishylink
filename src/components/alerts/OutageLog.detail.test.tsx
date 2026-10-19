// Every event row opens its detail, and an outage the recorder timed carries
// its report there: the five minutes before the drop, the heater, thermal state
// and the copy buttons. A dish-unreachable outage logged nothing on the dish,
// so its report gets a row of its own.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import i18n from "i18next";
import type { OutageReport } from "@core/postmortem";
import type { OutageEvent } from "@core/telemetry";
import { setLocale } from "../../lib/locale";
import { OutageLog } from "./OutageLog";
import { eventDetailKind, eventDetailSpan, eventDetailText } from "./eventDetail";

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setLocale("en");
});

const NOW = Date.now();
const DROP = NOW - 180_000;

const dishEvent: OutageEvent = {
  startMs: DROP - 2_000,
  durationMs: 182_000,
  cause: "EVENT_REASON_OUTAGE_NO_PINGS",
  severity: "warning",
};

const bandSwitch: OutageEvent = {
  startMs: NOW - 3_600_000,
  durationMs: 0,
  cause: "EVENT_REASON_CLIENT_SWITCHING_BAND",
  severity: "advisory",
};

function report(overrides: Partial<OutageReport> = {}): OutageReport {
  return {
    id: `system:starlinkOutage:${DROP + 8_000}`,
    source: "starlinkOutage",
    startMs: DROP,
    endMs: NOW,
    durationMs: NOW - DROP,
    cause: "NO_PINGS",
    beforeDrop: {
      windowStartMs: DROP - 300_000,
      windowEndMs: DROP,
      coverageSeconds: 300,
      latencyAvgMs: 40.5,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      dropRateAvg: 0.002,
      heaterActive: true,
      source: "samples",
    },
    thermal: [{ alertKey: "thermalThrottle", startMs: DROP - 240_000, endMs: DROP - 120_000 }],
    generatedAtMs: NOW + 1_000,
    ...overrides,
  };
}

const bodyText = () => document.body.textContent ?? "";

test("an outage row the recorder timed opens its detail with the report's figures", async () => {
  render(<OutageLog outageEvents={[dishEvent, bandSwitch]} reports={[report()]} />);

  await page.getByRole("button", { name: /Ping Network Interruption/ }).click();
  await expect.poll(bodyText).toContain("Event details");

  const text = bodyText();
  expect(text).toContain("Five minutes before the drop");
  expect(text).toContain("41 ms");
  expect(text).toContain("100.0 Mbps");
  expect(text).toContain("0.2%");
  expect(text).toContain("Running");
  expect(text).toContain("thermal throttle");
  expect(text).toContain("Copy JSON");
});

test("an event the recorder never timed still opens, with the explanation and no figures", async () => {
  render(<OutageLog outageEvents={[dishEvent, bandSwitch]} reports={[report()]} />);

  await page.getByRole("button", { name: /WiFi band/ }).click();
  await expect.poll(bodyText).toContain("Event details");

  const text = bodyText();
  expect(text).toContain("did not time this event");
  expect(text).not.toContain("Five minutes before the drop");
  expect(text).not.toContain("Copy JSON");
});

test("the duration column and the info dot stay on every row", async () => {
  render(<OutageLog outageEvents={[dishEvent]} reports={[]} />);
  await expect.poll(() => document.querySelector(".thin-scroll > div")).not.toBeNull();
  const row = document.querySelector(".thin-scroll > div");
  expect(row?.textContent).toContain("3m 2s");
  expect(row?.querySelector("[role='note']")).not.toBeNull();
  // The dot sits beside the row's button, never inside it.
  expect(row?.querySelector("button [role='note']")).toBeNull();
});

test("a dish-unreachable report the dish logged nothing for gets its own row", async () => {
  const unreachable = report({
    id: `system:dishUnreachable:${NOW - 7_200_000}`,
    source: "dishUnreachable",
    startMs: NOW - 7_200_000,
    endMs: NOW - 7_140_000,
    durationMs: 60_000,
    cause: null,
  });
  render(<OutageLog outageEvents={[bandSwitch]} reports={[unreachable]} />);

  await expect.poll(bodyText).toContain("2 events");
  await page.getByRole("button", { name: /Dish unreachable/ }).click();
  await expect.poll(bodyText).toContain("Five minutes before the drop");
});

test("Copy JSON writes the report itself", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(<OutageLog outageEvents={[dishEvent]} reports={[report()]} />);
  await page.getByRole("button", { name: /Ping Network Interruption/ }).click();
  await page.getByRole("button", { name: "Copy JSON" }).click();

  expect(writeText).toHaveBeenCalledOnce();
  const written = JSON.parse(writeText.mock.calls[0][0] as string) as OutageReport;
  expect(written.id).toBe(report().id);
  expect(written.beforeDrop.heaterActive).toBe(true);
});

test("the time line shows only the start when the event ends in the minute it began", () => {
  const minute = new Date(2026, 9, 17, 6, 58, 10).getTime();
  const blip = { ...dishEvent, startMs: minute, durationMs: 1_000 };
  expect(eventDetailSpan(blip, i18n.t, "en")).not.toContain(" to ");

  const spanning = { ...dishEvent, startMs: minute, durationMs: 120_000 };
  expect(eventDetailSpan(spanning, i18n.t, "en")).toContain(" to ");
});

test("the detail tags each event Outage, Degraded or Info, as the official app does", () => {
  const packetLoss: OutageEvent = {
    startMs: NOW,
    durationMs: 5_300,
    cause: "EVENT_REASON_HIGH_DOWNLINK_PACKET_LOSS",
    severity: "advisory",
  };
  const thermalThrottle: OutageEvent = {
    startMs: NOW,
    durationMs: 60_000,
    cause: "thermal throttle",
    severity: "warning",
  };
  expect(eventDetailKind(dishEvent, report())).toBe("outage");
  expect(eventDetailKind(dishEvent, null)).toBe("outage");
  expect(eventDetailKind(packetLoss, null)).toBe("degraded");
  expect(eventDetailKind(bandSwitch, null)).toBe("info");
  expect(eventDetailKind(thermalThrottle, null)).toBe("degraded");
});

test("the packet-loss event carries the official app's name and a Degraded tag", async () => {
  const packetLoss: OutageEvent = {
    startMs: NOW,
    durationMs: 5_300,
    cause: "EVENT_REASON_HIGH_DOWNLINK_PACKET_LOSS",
    severity: "advisory",
  };
  render(<OutageLog outageEvents={[packetLoss]} reports={[]} />);
  await page.getByRole("button", { name: /Elevated packet loss/ }).click();
  await expect.poll(bodyText).toContain("Event details");
  expect(bodyText()).toContain("Degraded");
});

test("the copied text prints the same sections the card shows", () => {
  const text = eventDetailText(dishEvent, report(), i18n.t, "en");
  expect(text).toContain("Dishylink outage report: Ping Network Interruption");
  expect(text).toContain("Latency: 41 ms");
  expect(text).toContain("Downlink: 100.0 Mbps");
  expect(text).toContain("Packet loss: 0.2%");
  expect(text).toContain("Heater: Running");
  expect(text).toContain("300 s of the window recorded");
});

test("figures nobody recorded read as not recorded, never invented", () => {
  const text = eventDetailText(
    dishEvent,
    report({
      beforeDrop: {
        windowStartMs: DROP - 300_000,
        windowEndMs: DROP,
        coverageSeconds: 0,
        latencyAvgMs: null,
        downlinkAvgBps: null,
        uplinkAvgBps: null,
        dropRateAvg: null,
        heaterActive: false,
        source: "minute-buckets",
      },
      thermal: [],
    }),
    i18n.t,
    "en",
  );
  expect(text).toContain("Latency: not recorded");
  expect(text).toContain("Packet loss: not recorded");
  expect(text).toContain("Heater: Off");
});

test("the detail follows the chosen language", async () => {
  setLocale("de");
  render(<OutageLog outageEvents={[dishEvent]} reports={[report()]} />);

  await page.getByRole("button", { name: /Netzunterbrechung|Ping/ }).click();
  await expect.poll(bodyText).toContain("Ereignisdetails");
  expect(bodyText()).toContain("Fünf Minuten vor dem Ausfall");
  expect(bodyText()).toContain("JSON kopieren");
});

test("hovering an event's time shows its date, and clicking the time opens the event", async () => {
  const startMs = new Date(2026, 7, 22, 2, 57).getTime();
  const booting: OutageEvent = {
    startMs,
    durationMs: 71_000,
    cause: "EVENT_REASON_OUTAGE_BOOTING",
    severity: "advisory",
  };
  render(<OutageLog outageEvents={[booting]} reports={[]} />);
  const time = page.getByText(/2:57/);

  await time.hover();
  await expect.poll(bodyText).toContain("Aug 22, 2026");

  await time.click();
  await expect.poll(bodyText).toContain("Event details");
});

test("the row names the full date for a screen reader", async () => {
  const startMs = new Date(2026, 7, 22, 2, 57).getTime();
  render(
    <OutageLog
      outageEvents={[
        {
          startMs,
          durationMs: 0,
          cause: "EVENT_REASON_CLIENT_SWITCHING_BAND",
          severity: "advisory",
        },
      ]}
      reports={[]}
    />,
  );
  await expect
    .element(page.getByRole("button", { name: /Aug 22, 2026 · 2:57/ }))
    .toBeInTheDocument();
});
