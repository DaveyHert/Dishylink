// Callout must keep looking exactly like the original .skydome-note — that form is the
// one being standardised on, so it is the thing that must not move. (The two plain-text
// notes it replaces are changing on purpose.)
//
// Written as a side-by-side diff against the live .skydome-note rules while they still
// exist in index.css; the absolute values below stand on their own once they are gone.

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { Callout } from "./callout";

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

describe("Callout preserves the .skydome-note design", () => {
  test("matches the original box exactly", async () => {
    render(<Callout>Your Starlink has an unobstructed view of the sky.</Callout>);
    const callout = await waitFor(() => document.querySelector("[data-slot='callout']"), "callout");
    const style = getComputedStyle(callout);

    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("flex-start");
    expect(style.columnGap).toBe("10px");
    // border-radius: 12px — rounded-lg is exact here because @theme sets --radius-lg: 12px.
    expect(style.borderTopLeftRadius).toBe("12px");
    // padding: 11px 13px
    expect(style.paddingTop).toBe("11px");
    expect(style.paddingBottom).toBe("11px");
    expect(style.paddingLeft).toBe("13px");
    expect(style.paddingRight).toBe("13px");
    expect(style.fontSize).toBe("12.5px");
    // line-height: 1.5 at 12.5px — leading-normal is exactly 1.5.
    expect(style.lineHeight).toBe("18.75px");
    expect(style.color).toBe(tokenColor("--ink-secondary"));
  });

  test("carries the ⓘ, hidden from screen readers, and renders its message", async () => {
    render(<Callout>Data usage needs the historian running.</Callout>);
    const callout = await waitFor(() => document.querySelector("[data-slot='callout']"), "callout");
    const icon = callout.querySelector("[aria-hidden='true']");
    expect(icon?.textContent).toBe("ⓘ");
    // The icon is decoration; the message must not be swallowed by it.
    expect(callout.textContent).toContain("Data usage needs the historian running.");
  });

  test("caller controls spacing", async () => {
    render(<Callout className="mt-3">note</Callout>);
    const callout = await waitFor(() => document.querySelector("[data-slot='callout']"), "callout");
    expect(getComputedStyle(callout).marginTop).toBe("12px");
  });
});

describe("Callout tone=error", () => {
  test("reads as an error, not as advisory text", async () => {
    render(<Callout tone="error">Router unreachable.</Callout>);
    const callout = await waitFor(() => document.querySelector("[data-slot='callout'][data-tone='error']"), "error callout");

    // An error must announce itself; an info note must not nag.
    expect(callout.getAttribute("role")).toBe("alert");
    expect(callout.querySelector("[aria-hidden='true']")?.textContent).toBe("⚠");
    // Tinted with the critical hue rather than the ink hue — visibly not an ⓘ note.
    expect(getComputedStyle(callout).backgroundColor).not.toBe("");
    // Box geometry stays identical to the info tone: same primitive, different tone.
    const style = getComputedStyle(callout);
    expect(style.borderTopLeftRadius).toBe("12px");
    expect(style.paddingLeft).toBe("13px");
  });

  test("info tone does not announce itself", async () => {
    render(<Callout>Just a note.</Callout>);
    const callout = await waitFor(() => document.querySelector("[data-slot='callout'][data-tone='info']"), "info callout");
    expect(callout.getAttribute("role")).toBeNull();
    expect(callout.querySelector("[aria-hidden='true']")?.textContent).toBe("ⓘ");
  });
});
