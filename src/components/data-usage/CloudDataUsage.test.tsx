// Regression cover for the states CloudDataUsage reaches when the cloud answers
// but there is nothing to draw. The happy path is exercised by the proxy tests
// and live probing; what broke here were the edges.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { noteCloudSessionChanged } from "../../lib/cloudHost";
import { CloudDataUsage } from "./CloudDataUsage";

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Stub /cloud/usage with a given envelope. */
function stubUsage(body: unknown, status = 200) {
  vi.stubGlobal("fetch", async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }));
}

const text = () => document.body.textContent ?? "";

afterEach(() => {
  // The account/usage data lives in one shared store per session, not per
  // component, so a fetch's result outlives the render that asked for it.
  // Unmount, then return the store to its pre-connection state the same way the
  // app does when the session changes — otherwise the next case reads the answer
  // this one loaded and asserts against a snapshot it never stubbed.
  cleanup();
  noteCloudSessionChanged();
  vi.unstubAllGlobals();
});

describe("CloudDataUsage", () => {
  test("shows an empty state — not a forever spinner — when there are no billing cycles", async () => {
    // A service line whose first cycle hasn't been reported yet must not fall
    // into the Loading branch (`status === "loading" || !cycle`) and spin
    // indefinitely.
    stubUsage({ content: { billingCyclesAnnotated: [], servicePlan: {} } });
    render(<CloudDataUsage active />);

    await waitFor(
      () => (document.querySelector("[data-slot='empty-state']") ? true : null),
      "empty state",
    );
    expect(text()).toContain("hasn’t reported a billing cycle");
    expect(text()).not.toContain("Loading Starlink billing data");
  });

  test("survives an envelope with no content instead of crashing the panel", async () => {
    // Upstream JSON is unvalidated: an envelope missing `content` must fall
    // through to the empty-state branch, not throw.
    stubUsage({ errors: ["nope"], isValid: false });
    render(<CloudDataUsage active />);

    await waitFor(
      () => (document.querySelector("[data-slot='empty-state']") ? true : null),
      "empty state",
    );
    expect(text()).toContain("hasn’t reported a billing cycle");
  });

  test("renders a real failure as an error callout, not an advisory one", async () => {
    stubUsage({}, 500);
    render(<CloudDataUsage active />);

    const el = await waitFor(() => document.querySelector("[data-slot='callout']"), "callout");
    expect(el.getAttribute("data-tone")).toBe("error");
    expect(el.getAttribute("role")).toBe("alert");
  });

  test("defaults to the newest cycle — the feed orders them oldest-first", async () => {
    // Verified against the live endpoint: billingCyclesAnnotated ascends by
    // startDate, so the last entry is the current cycle.
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        dataBuckets: [{ name: "Residential Data" }],
        billingCyclesAnnotated: [
          {
            startDate: "2026-06-06T00:00:00+00:00",
            endDate: "2026-07-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
          {
            startDate: "2026-07-06T00:00:00+00:00",
            endDate: "2026-08-06T00:00:00+00:00",
            totalAmountGB: 304.24,
            dailyData: [[3], [4]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    await waitFor(() => (text().includes("GB") ? true : null), "usage headline");
    // The newest cycle's total, not the older one's.
    expect(text()).toContain("304");
    expect(text()).not.toContain("463");
    expect(text()).toContain("unlimited");
  });

  test("offers an All stop that totals every reported cycle", async () => {
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        dataBuckets: [{ name: "Residential Data" }],
        billingCyclesAnnotated: [
          {
            startDate: "2026-06-06T00:00:00+00:00",
            endDate: "2026-07-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
          {
            startDate: "2026-07-06T00:00:00+00:00",
            endDate: "2026-08-06T00:00:00+00:00",
            totalAmountGB: 304.24,
            dailyData: [[3], [4]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    const all = await waitFor(
      () =>
        [...document.querySelectorAll("[data-slot='segmented-control-item']")].find(
          (item) => item.textContent?.trim() === "All",
        ) ?? null,
      "All stop",
    );
    (all as HTMLElement).click();

    // 463.49 + 304.24 = 767.73, and the per-cycle allowance line gives way to
    // the span the total covers.
    await waitFor(() => (text().includes("768") || text().includes("767") ? true : null), "total");
    expect(text()).toContain("2 billing cycles");
    expect(text()).not.toContain("Usage Limit");
    // Cycles are named by month, not by the billing day, which is the same
    // number on every one of them and so carries nothing per cycle.
    expect(text()).toContain("Jul 2026");
    expect(text()).not.toContain("Jul 6, 2026");
  });

  test("marks a cycle the account never reported instead of drawing it as zero", async () => {
    // The opening cycle of a service line arrives as 0 GB across zero days.
    // Drawn as a bar it would claim a month of measured silence; it is an
    // absence, and the total must not be dated from it either.
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        dataBuckets: [{ name: "Residential Data" }],
        billingCyclesAnnotated: [
          {
            startDate: "2026-02-06T00:00:00+00:00",
            endDate: "2026-03-06T00:00:00+00:00",
            totalAmountGB: 0,
            dailyData: [],
          },
          {
            startDate: "2026-03-06T00:00:00+00:00",
            endDate: "2026-04-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
          {
            startDate: "2026-04-06T00:00:00+00:00",
            endDate: "2026-05-06T00:00:00+00:00",
            totalAmountGB: 304.24,
            dailyData: [[3], [4]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    const all = await waitFor(
      () =>
        [...document.querySelectorAll("[data-slot='segmented-control-item']")].find(
          (item) => item.textContent?.trim() === "All",
        ) ?? null,
      "All stop",
    );
    (all as HTMLElement).click();

    await waitFor(
      () => document.querySelector("[data-slot='cycle-not-reported']"),
      "not-reported wash",
    );
    expect(text()).toContain("Feb 2026 · not reported");
    expect(text()).not.toContain("Feb 2026 · 0 GB");
    // Two reported cycles out of the three listed, dated from the first with data.
    expect(text()).toContain("2 billing cycles");
    expect(text()).toContain("Mar 6, 2026");
    expect(text()).not.toContain("Feb 6, 2026");
  });

  test("says so on an unreported cycle's own tab instead of showing a bare 0 GB", async () => {
    // Selected on its own, an unreported cycle has no columns to draw, so the
    // chart area collapses to nothing and the headline claims a measured zero.
    // Both need to say that nothing was reported.
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        dataBuckets: [{ name: "Residential Data" }],
        billingCyclesAnnotated: [
          {
            startDate: "2026-02-06T00:00:00+00:00",
            endDate: "2026-03-06T00:00:00+00:00",
            totalAmountGB: 0,
            dailyData: [],
          },
          {
            startDate: "2026-03-06T00:00:00+00:00",
            endDate: "2026-04-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    const feb = await waitFor(
      () =>
        [...document.querySelectorAll("[data-slot='segmented-control-item']")].find(
          (item) => item.textContent?.trim() === "Feb",
        ) ?? null,
      "Feb stop",
    );
    (feb as HTMLElement).click();

    await waitFor(
      () => document.querySelector("[data-slot='empty-state']"),
      "not-reported empty state",
    );
    expect(text()).toContain("Not reported");
    expect(text()).toContain("No daily usage was reported for this billing cycle");
    // The allowance line would imply a cycle that was measured against it.
    expect(text()).not.toContain("Usage Limit");
    // The billing dates are still true and stay on screen.
    expect(text()).toContain("billing cycle");
  });

  test("draws the chart normally on a reported cycle's own tab", async () => {
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        dataBuckets: [{ name: "Residential Data" }],
        billingCyclesAnnotated: [
          {
            startDate: "2026-02-06T00:00:00+00:00",
            endDate: "2026-03-06T00:00:00+00:00",
            totalAmountGB: 0,
            dailyData: [],
          },
          {
            startDate: "2026-03-06T00:00:00+00:00",
            endDate: "2026-04-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    // Defaults to the newest cycle, which is the reported one.
    await waitFor(() => (text().includes("463") ? true : null), "usage headline");
    expect(document.querySelector("[data-slot='empty-state']")).toBeNull();
    expect(text()).toContain("Usage Limit");
    expect(text()).not.toContain("Not reported");
  });

  test("keeps a genuine zero cycle as a bar, since its days were reported", async () => {
    // Days present and all zero is a dish that was off. That is a reading, and
    // washing it out would hide a real month.
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        billingCyclesAnnotated: [
          {
            startDate: "2026-02-06T00:00:00+00:00",
            endDate: "2026-03-06T00:00:00+00:00",
            totalAmountGB: 0,
            dailyData: [[0], [0]],
          },
          {
            startDate: "2026-03-06T00:00:00+00:00",
            endDate: "2026-04-06T00:00:00+00:00",
            totalAmountGB: 463.49,
            dailyData: [[1], [2]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    const all = await waitFor(
      () =>
        [...document.querySelectorAll("[data-slot='segmented-control-item']")].find(
          (item) => item.textContent?.trim() === "All",
        ) ?? null,
      "All stop",
    );
    (all as HTMLElement).click();

    await waitFor(() => (text().includes("billing cycles") ? true : null), "all view");
    expect(document.querySelector("[data-slot='cycle-not-reported']")).toBeNull();
    expect(text()).toContain("Feb 2026 · 0 GB");
    expect(text()).toContain("2 billing cycles");
  });

  test("has no All stop with a single cycle — it would restate the figure on screen", async () => {
    stubUsage({
      content: {
        servicePlan: { usageLimitGB: 100_000 },
        billingCyclesAnnotated: [
          {
            startDate: "2026-07-06T00:00:00+00:00",
            endDate: "2026-08-06T00:00:00+00:00",
            totalAmountGB: 304.24,
            dailyData: [[3], [4]],
          },
        ],
      },
    });
    render(<CloudDataUsage active />);

    await waitFor(() => (text().includes("GB") ? true : null), "usage headline");
    const labels = [...document.querySelectorAll("[data-slot='segmented-control-item']")].map(
      (item) => item.textContent?.trim(),
    );
    expect(labels).not.toContain("All");
  });
});
