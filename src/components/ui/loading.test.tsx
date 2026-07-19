import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { Loading } from "./loading";

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("Loading", () => {
  test("spinner only, when there is nothing useful to say", async () => {
    render(<Loading />);
    const loading = await waitFor(() => document.querySelector("[data-slot='loading']"), "loading");
    expect(loading.querySelector("[role='status']")).not.toBeNull();
    expect(loading.textContent).toBe("");
    // Still announced, even with no visible message.
    expect(loading.querySelector("[role='status']")?.getAttribute("aria-label")).toBe("Loading");
  });

  test("spinner plus the caller's message", async () => {
    render(<Loading message="Contacting the router…" />);
    const loading = await waitFor(() => document.querySelector("[data-slot='loading']"), "loading");
    expect(loading.textContent).toContain("Contacting the router…");
    // The message is what screen readers announce — not a generic "Loading".
    expect(loading.querySelector("[role='status']")?.getAttribute("aria-label")).toBe("Contacting the router…");
  });

  test("matches the muted note styling it replaces", async () => {
    render(<Loading message="Reading dish configuration…" />);
    const loading = await waitFor(() => document.querySelector("[data-slot='loading']"), "loading");
    const style = getComputedStyle(loading);
    // .empty-note was: font-size 13px, font-weight 500, padding 18px 0, centred.
    expect(style.fontSize).toBe("13px");
    expect(style.fontWeight).toBe("500");
    expect(style.paddingTop).toBe("18px");
    expect(style.paddingBottom).toBe("18px");
    expect(style.justifyContent).toBe("center");
  });
});
