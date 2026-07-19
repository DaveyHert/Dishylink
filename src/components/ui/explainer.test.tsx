// The Explainer's TYPOGRAPHY must match the old .detail-explainer exactly — that part
// is the established design. Its CONTAINER deliberately changes: a hairline rule
// becomes a bordered box, matching the Starlink iOS app.

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { Explainer } from "./explainer";

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function tokenColor(token: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

describe("Explainer", () => {
  test("keeps the original body typography", async () => {
    render(<Explainer title="What is latency?">Latency measures how long a request takes.</Explainer>);
    const box = await waitFor(() => document.querySelector("[data-slot='explainer']"), "explainer");
    const style = getComputedStyle(box);
    // .detail-explainer was: font-size 13.5px; line-height 1.55; color var(--ink-secondary)
    expect(style.fontSize).toBe("13.5px");
    expect(style.lineHeight).toBe("20.925px"); // 13.5 * 1.55
    expect(style.color).toBe(tokenColor("--ink-secondary"));
  });

  test("keeps the original title typography", async () => {
    render(<Explainer title="What is latency?">body</Explainer>);
    const title = await waitFor(() => document.querySelector("[data-slot='explainer-title']"), "title");
    const style = getComputedStyle(title);
    // .detail-explainer-title was: font-size 14.5px; font-weight 650; color var(--ink)
    expect(style.fontSize).toBe("14.5px");
    expect(style.fontWeight).toBe("650");
    expect(style.color).toBe(tokenColor("--ink"));
  });

  test("is a bordered box, not a rule — the deliberate change", async () => {
    render(<Explainer title="What is latency?">body</Explainer>);
    const box = await waitFor(() => document.querySelector("[data-slot='explainer']"), "explainer");
    const style = getComputedStyle(box);
    // Bordered on all four sides now, where .detail-explainer had border-top only.
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderBottomWidth).toBe("1px");
    expect(style.borderLeftWidth).toBe("1px");
    expect(style.borderRightWidth).toBe("1px");
    expect(style.borderTopColor).toBe(tokenColor("--hairline"));
    // rounded-xl is exact: @theme declares --radius-xl: 16px.
    expect(style.borderTopLeftRadius).toBe("16px");
    expect(style.paddingLeft).toBe("14px");
    expect(style.paddingTop).toBe("13px");
  });

  test("renders the caller's prose", async () => {
    render(<Explainer title="How is this measured?">DishyLink integrates the dish's telemetry.</Explainer>);
    const box = await waitFor(() => document.querySelector("[data-slot='explainer']"), "explainer");
    expect(box.textContent).toContain("DishyLink integrates the dish's telemetry.");
  });
});
