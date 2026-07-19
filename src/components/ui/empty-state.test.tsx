import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { EmptyState } from "./empty-state";

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

describe("EmptyState", () => {
  test("matches the .empty-note typography it replaces", async () => {
    render(<EmptyState>no outages recorded in the current window</EmptyState>);
    const el = await waitFor(() => document.querySelector("[data-slot='empty-state']"), "empty state");
    const style = getComputedStyle(el);
    // .empty-note was: font-size 13px; font-weight 500; color var(--ink-muted); centred.
    expect(style.fontSize).toBe("13px");
    expect(style.fontWeight).toBe("500");
    expect(style.textAlign).toBe("center");
    expect(style.color).toBe(tokenColor("--ink-muted"));
  });

  test("caller controls padding — a card and a popover want different", async () => {
    render(<EmptyState className="py-[18px]">nothing</EmptyState>);
    const el = await waitFor(() => document.querySelector("[data-slot='empty-state']"), "empty state");
    expect(getComputedStyle(el).paddingTop).toBe("18px");
  });
});
