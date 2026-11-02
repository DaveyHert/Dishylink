// A band switch's popup shows the two bands and the device as the network list
// shows it, from the recorder's device list, and opens that device's details.

import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { OutageEvent } from "@core/telemetry";
import type { ClientUsageTotal } from "@core/clientUsage";
import { setApiHost } from "../../lib/apiHost";
import { setLocale } from "../../lib/locale";
import { OutageLog } from "./OutageLog";

let totals: Partial<ClientUsageTotal>[] = [];
setApiHost({
  transport: async (path) =>
    new Response(JSON.stringify(path.startsWith("/api/clients/totals") ? { totals } : {}), {
      headers: { "content-type": "application/json" },
    }),
});

afterEach(() => {
  cleanup();
  totals = [];
  localStorage.clear();
  setLocale("en");
});

const bodyText = () => document.body.textContent ?? "";

function bandSwitch(clientId: number): OutageEvent {
  return {
    startMs: Date.now() - 60_000,
    durationMs: 0,
    cause: "EVENT_REASON_CLIENT_SWITCHING_BAND",
    severity: "advisory",
    bandSwitch: { clientId, fromBand: "RF_5GHZ", toBand: "RF_2GHZ" },
  };
}

test("shows the bands and the device by the name the recorder knows", async () => {
  totals = [{ clientId: 42, macAddress: "8a:12:34:56:78:9a", name: "Kitchen iPad" }];
  render(<OutageLog outageEvents={[bandSwitch(42)]} reports={[]} />);
  await page.getByRole("button", { name: /WiFi band/ }).click();

  await expect.poll(bodyText).toContain("Kitchen iPad");
  const text = bodyText();
  expect(text).toContain("5 GHz");
  expect(text).toContain("2.4 GHz");
  expect(text).toContain("Private");
  expect(text).not.toContain("did not time this event");
});

test("a device the router never named shows its IP address, as the network list does", async () => {
  totals = [{ clientId: 7, macAddress: "1a:e8:91:00:00:01", ipAddress: "192.168.1.186" }];
  render(<OutageLog outageEvents={[bandSwitch(7)]} reports={[]} />);
  await page.getByRole("button", { name: /WiFi band/ }).click();
  await expect.poll(bodyText).toContain("192.168.1.186");
  expect(bodyText()).toContain("Private");
});

test("the device card opens that device in the network panel", async () => {
  totals = [{ clientId: 42, macAddress: "8a:12:34:56:78:9a", name: "Kitchen iPad" }];
  const onOpenDevice = vi.fn();
  render(<OutageLog outageEvents={[bandSwitch(42)]} reports={[]} onOpenDevice={onOpenDevice} />);
  await page.getByRole("button", { name: /WiFi band/ }).click();
  await page.getByRole("button", { name: /Kitchen iPad/ }).click();

  expect(onOpenDevice).toHaveBeenCalledWith("8a:12:34:56:78:9a|42");
  await expect.poll(bodyText).not.toContain("Event details");
});
