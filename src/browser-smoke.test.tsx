// Proves the browser test project works before any fidelity test relies on it:
// real Chromium, index.css loaded, theme tokens resolving, getComputedStyle returning
// real values. If this fails, every other style assertion is meaningless.
//
// Note: React 19 commits asynchronously, so the DOM is not populated on the line after
// render() — hence `await tick()`. jsdom could not run any of this: it has no CSS
// engine, so getComputedStyle would return defaults and prove nothing.
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test("the real CSS engine resolves Tailwind utilities + theme tokens", async () => {
  // rounded-xl reads --radius-xl (16px) from @theme; the arbitrary padding utilities
  // exercise the same engine the migrated cards now rely on.
  render(
    <div data-testid='probe' className='rounded-xl px-[18px] py-4'>
      card
    </div>,
  );
  await tick();
  const probe = document.querySelector('[data-testid="probe"]');
  expect(probe, "component should be mounted").not.toBeNull();

  const style = getComputedStyle(probe!);
  expect(style.borderTopLeftRadius).toBe("16px");
  expect(style.paddingTop).toBe("16px");
  expect(style.paddingLeft).toBe("18px");
});

test("bg-card is an exact substitute for background: var(--surface)", async () => {
  render(<div className='bg-card'>card</div>);
  await tick();

  // Tailwind v4's `@theme inline` RESOLVES the var at build time, so --color-card
  // computes to the literal colour, not the string "var(--surface)". The identity
  // therefore has to be proven by value — which is the only sense that matters.
  const root = getComputedStyle(document.documentElement);
  const surface = root.getPropertyValue("--surface").trim();
  const colorCard = root.getPropertyValue("--color-card").trim();

  expect(surface).not.toBe("");
  expect(colorCard).toBe(surface);
});
