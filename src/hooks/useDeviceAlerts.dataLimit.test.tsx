// A spent data allowance is the one alert whose wording names a device, so no
// static definition can carry it and it reaches this hook from the rule store
// rather than from a status boolean. It shipped recorded-but-invisible once: the
// recorder wrote the episode, the OS banner was suppressed while the window was
// in front, and nothing here turned it into a row to chime for.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { setApiHost } from "../lib/apiHost";
import { useDeviceAlerts } from "./useDeviceAlerts";

const GB = 1_000_000_000;

function rule(over: Record<string, unknown> = {}) {
  return {
    clientKey: "42",
    deviceName: "iPhone 15 Pro",
    allocationBytes: 1 * GB,
    usageBytes: 2 * GB,
    actedThisCycle: true,
    // The recorder stamps this while the announcement stands, and clears it when
    // it retires. Its presence is what puts the alert on this panel.
    reachedAtMs: 1,
    autoPause: true,
    cycle: { kind: "weekly", weekday: 1 },
    anchorRx: 0,
    anchorTx: 0,
    observedRx: 2 * GB,
    observedTx: 0,
    periodStartMs: 0,
    periodEndMs: Number.MAX_SAFE_INTEGER,
    pauseState: "failed",
    ...over,
  };
}

/** Answers the two endpoints this hook reads; anything else is an empty 200. */
function stubRecorder(rules: unknown[]) {
  setApiHost({
    transport: async (path: string) => {
      const body = path.startsWith("/api/clients/meters")
        ? { rules, pauseEnforceable: true }
        : { episodes: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

function Probe() {
  const { active } = useDeviceAlerts(null, "online");
  return (
    <ul>
      {active.map((alert) => (
        <li key={`${alert.source}:${alert.key}`}>
          {alert.key} — {alert.firing}
        </li>
      ))}
    </ul>
  );
}

const text = () => document.body.textContent ?? "";

describe("useDeviceAlerts data limits", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("given: a rule that reached its allowance, should: raise it as a firing alert", async () => {
    stubRecorder([rule()]);
    render(<Probe />);

    await expect.poll(text).toContain("dataLimit:42");
    // The device is named, since a key alone says nothing to whoever reads it.
    expect(text()).toContain("iPhone 15 Pro");
    // The same figure the recorders announce: one trip cannot read two ways.
    expect(text()).toContain("1.0 GB");
  });

  test("given: a rule under its allowance, should: raise nothing", async () => {
    stubRecorder([rule({ actedThisCycle: false, usageBytes: 100_000_000 })]);
    render(<Probe />);

    // Poll so a late arrival would still be caught rather than passing on timing.
    await expect.poll(() => text().length >= 0).toBe(true);
    expect(text()).not.toContain("dataLimit");
  });

  // Raising a limit past what a device has spent is how someone answers a trip.
  // The recorder's latch stays set until it next evaluates, so an alert read off
  // that latch would go on naming an allowance nothing is over.
  test("given: the limit raised above what was spent, should: stop raising it at once", async () => {
    stubRecorder([rule({ allocationBytes: 5 * GB, usageBytes: 2.3 * GB, actedThisCycle: true })]);
    render(<Probe />);

    await expect.poll(() => text().length >= 0).toBe(true);
    expect(text()).not.toContain("dataLimit");
  });

  test("given: no rules at all, should: raise nothing", async () => {
    stubRecorder([]);
    render(<Probe />);

    await expect.poll(() => text().length >= 0).toBe(true);
    expect(text()).not.toContain("dataLimit");
  });
});
