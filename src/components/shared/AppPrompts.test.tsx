// The what's-new check runs when its module loads, so this file stages an upgraded
// profile before importing the prompts. localStorage is shared by every file in the
// browser project, so whatever is staged here is taken back out afterwards.

import { afterAll, afterEach, describe, expect, test } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { setLocale } from "@/lib/locale";

const STAGED = ["dishylink-theme", "dishylink-whats-new-seen", "dishylink-installed-at"];

STAGED.forEach((key) => localStorage.removeItem(key));
localStorage.setItem("dishylink-theme", "dark");

const { AppPrompts } = await import("./AppPrompts");

const text = () => document.body.textContent ?? "";

async function waitForText(substring: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (text().includes(substring)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for text: ${substring}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled: ${label}`);
  return found as HTMLButtonElement;
}

afterEach(cleanup);
afterAll(() => STAGED.forEach((key) => localStorage.removeItem(key)));

describe("what's new after an update", () => {
  test("speaks the app's language", async () => {
    setLocale("es");
    render(<AppPrompts />);
    await waitForText("Novedades de Dishylink 1.3");
    expect(text()).toContain("Soporte multilingüe.");
    expect(text()).toContain("Acabamos de lanzar Jobmate");
    button("Entendido");
  });

  test("opens the walkthrough on its own, with Jobmate above and no changelog", async () => {
    render(<AppPrompts />);
    await waitForText("See Jobmate in action");
    button("See Jobmate in action").click();
    await settle();

    expect(document.querySelector("iframe")?.src).toContain(
      "youtube-nocookie.com/embed/BxpOIzJBlg8",
    );
    expect(text()).toContain("We just launched Jobmate");
    expect(text()).not.toContain("Multi-language support");

    (document.querySelector("button[aria-label='Back']") as HTMLButtonElement).click();
    await waitForText("Multi-language support");
    expect(document.querySelector("iframe")).toBeNull();
  });

  test("shows once, and stays gone after Got it", async () => {
    render(<AppPrompts />);
    await waitForText("What’s new in Dishylink 1.3");
    expect(text()).toContain("Full release notes");
    expect(text()).not.toContain("Maybe later");

    button("Got it").click();
    await settle();
    expect(text()).not.toContain("What’s new");

    cleanup();
    render(<AppPrompts />);
    await settle();
    expect(text()).not.toContain("What’s new");
  });
});
