// Regression cover for the states CloudDataUsage reaches when the cloud answers
// but there is nothing to draw. The happy path is exercised by the proxy tests
// and live probing; what broke here were the edges.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render } from "vitest-browser-react";
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
  vi.unstubAllGlobals();
});

describe("CloudDataUsage", () => {
  test("shows an empty state — not a forever spinner — when there are no billing cycles", async () => {
    // A service line whose first cycle hasn't been reported yet. This used to
    // fall back into the Loading branch (`status === "loading" || !cycle`) and
    // spin indefinitely with no way out.
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
    // Upstream JSON is unvalidated; `data.content.billingCyclesAnnotated` threw a
    // TypeError on this shape and took the whole sheet down.
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
});
