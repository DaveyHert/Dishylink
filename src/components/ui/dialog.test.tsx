import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";

async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function mount() {
  render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <p>body</p>
      </DialogContent>
    </Dialog>,
  );
  await waitFor(() => document.querySelector('[role="dialog"]'), "role=dialog");
  return document.querySelector("[data-slot='dialog-overlay']") as HTMLElement;
}

describe("Dialog overlay", () => {
  test("matches the drill-down sheet backdrop", async () => {
    const style = getComputedStyle(await mount());
    expect(style.backdropFilter).toBe("blur(5px)");
    expect(style.backgroundColor).toBe("oklab(0 0 0 / 0.55)");
  });
});
