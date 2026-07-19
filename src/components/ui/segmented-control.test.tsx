// Design-fidelity check for SegmentedControl.
//
// These assertions were first written as a side-by-side diff against the original
// `.window-picker` markup, and passed — that is how the swap was proven invisible.
// `.window-picker` has since been deleted from index.css, so the values are stated
// outright here. They ARE the spec now; this file is the only thing keeping the four
// call sites (charts, energy, data usage, stat detail) looking the way they did.
//
// Colours resolve through theme tokens rather than being hardcoded, so the check holds
// in both light and dark.

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { label: "15M", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "6H", value: "6h" },
] as const;

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function mountItems() {
  render(<SegmentedControl options={OPTIONS} value="1h" onChange={() => {}} label="Window" />);
  return await waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>("[data-slot='segmented-control-item']");
    return found.length ? found : null; // an empty NodeList is truthy
  }, "items");
}

/** Resolve a theme token the way the browser paints it, e.g. --ink-muted -> "rgb(...)". */
function tokenColor(token: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

describe("SegmentedControl preserves the .window-picker design", () => {
  test("group container", async () => {
    render(<SegmentedControl options={OPTIONS} value="1h" onChange={() => {}} label="Window" />);
    const group = await waitFor(() => document.querySelector("[data-slot='segmented-control']"), "group");
    const style = getComputedStyle(group);
    expect(style.display).toBe("inline-flex");
    // border-radius: 999px — rounded-full computes 9999px, a different value.
    expect(style.borderTopLeftRadius).toBe("999px");
    expect(style.overflowX).toBe("hidden");
  });

  test("inactive item", async () => {
    const items = await mountItems();
    const style = getComputedStyle(items[0]); // 15M
    // font-size: 10.5px; letter-spacing: 0.06em; padding: 5px 13px
    expect(style.fontSize).toBe("10.5px");
    expect(style.paddingTop).toBe("5px");
    expect(style.paddingBottom).toBe("5px");
    expect(style.paddingLeft).toBe("13px");
    expect(style.paddingRight).toBe("13px");
    expect(style.cursor).toBe("pointer");
    expect(style.borderTopWidth).toBe("0px");
    // color: var(--ink-muted) — text-muted-foreground is exact because @theme inline
    // declares --color-muted-foreground: var(--ink-muted).
    expect(style.color).toBe(tokenColor("--ink-muted"));
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)"); // transparent
  });

  test("active item", async () => {
    const items = await mountItems();
    const style = getComputedStyle(items[1]); // 1H
    // background: var(--ink); color: var(--page); font-weight: 600
    expect(style.backgroundColor).toBe(tokenColor("--ink"));
    expect(style.color).toBe(tokenColor("--page"));
    expect(style.fontWeight).toBe("600");
  });

  test("selecting an option reports its value, and deselect is ignored", async () => {
    const seen: string[] = [];
    render(<SegmentedControl options={OPTIONS} value="1h" onChange={(v) => seen.push(v)} label="Window" />);
    const items = await waitFor(() => {
      const found = document.querySelectorAll<HTMLElement>("[data-slot='segmented-control-item']");
      return found.length ? found : null;
    }, "items");

    items[2].click(); // 6H
    expect(seen).toEqual(["6h"]);

    // Clicking the ALREADY-active item deselects in a raw ToggleGroup, which would leave
    // the picker with no range at all. Must be ignored, not reported as a change.
    items[1].click(); // 1H, already active
    expect(seen).toEqual(["6h"]);
  });
});
