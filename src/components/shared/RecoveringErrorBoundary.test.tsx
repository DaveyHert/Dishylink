import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { RecoveringErrorBoundary } from "./RecoveringErrorBoundary";

// Throwing during a concurrent render makes React re-render synchronously and
// report the original throw to window.onerror — expected here, and the boundary
// handles it, so keep it from surfacing as an unhandled error for the suite.
const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => window.addEventListener("error", swallow));
afterEach(() => {
  window.removeEventListener("error", swallow);
  cleanup();
});

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Throws on render whenever the injected predicate says to. */
function Bomb({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) throw new Error("boom");
  return <div data-testid='ok'>ok</div>;
}

test("a transient throw recovers silently — no notice, content returns", async () => {
  let throwsLeft = 1;
  render(
    <RecoveringErrorBoundary>
      <Bomb shouldThrow={() => throwsLeft-- > 0} />
    </RecoveringErrorBoundary>,
  );
  await settle();
  expect(
    document.querySelector('[data-testid="ok"]'),
    "child should have remounted",
  ).not.toBeNull();
  expect(document.body.textContent).not.toContain("Reload");
});

test("a recurring throw stops retrying and shows the reload notice", async () => {
  render(
    <RecoveringErrorBoundary>
      <Bomb shouldThrow={() => true} />
    </RecoveringErrorBoundary>,
  );
  await settle();
  expect(document.querySelector('[data-testid="ok"]')).toBeNull();
  const reload = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Reload",
  );
  expect(reload, "reload notice should be shown after the retry budget").toBeTruthy();
});
