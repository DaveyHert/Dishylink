// An always-on install can run for weeks without relaunching. Once the release
// notes take launch's one popup, the donation ask must still come later in the
// same run — but not straight after the notes, and only when the window returns.
// The what's-new check runs when its module loads, so the profile is staged first.

import { afterAll, afterEach, expect, test, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGED = [
  "dishylink-theme",
  "dishylink-whats-new-seen",
  "dishylink-installed-at",
  "dishylink-prompt-donation",
];

STAGED.forEach((key) => localStorage.removeItem(key));
localStorage.setItem("dishylink-theme", "dark");
localStorage.setItem("dishylink-whats-new-seen", "1.3");
localStorage.setItem("dishylink-installed-at", String(Date.now() - 2 * DAY_MS));

const { AppPrompts } = await import("./AppPrompts");

const text = () => document.body.textContent ?? "";
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled: ${label}`);
  return found as HTMLButtonElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});
afterAll(() => STAGED.forEach((key) => localStorage.removeItem(key)));

test("the donation ask follows the release notes later in the same run", async () => {
  render(<AppPrompts />);
  await settle();
  expect(text()).toContain("What’s new in Dishylink 1.3.1");
  // Someone on 1.3 sees only what 1.3.1 added.
  expect(text()).toContain("Faster on busy networks.");
  expect(text()).not.toContain("Multi-language support.");

  button("Got it").click();
  await settle();
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(text(), "never straight after the notes").not.toContain("Dishylink is free");

  const later = Date.now() + 3 * 60 * 60 * 1000 + 60_000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(text()).toContain("Dishylink is free");
});
