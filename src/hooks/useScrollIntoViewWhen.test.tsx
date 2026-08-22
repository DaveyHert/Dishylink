// The revealing, not the scrolling: a confirmation that appears below the fold
// is one the reader decides on without its warning ever being on screen.

import { useState } from "react";
import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { useScrollIntoViewWhen } from "./useScrollIntoViewWhen";

afterEach(cleanup);

function Revealing({ start = false }: { start?: boolean }) {
  const [shown, setShown] = useState(start);
  const ref = useScrollIntoViewWhen<HTMLDivElement>(shown);
  return (
    <>
      <button onClick={() => setShown((was) => !was)}>toggle</button>
      {shown && <div ref={ref}>the warning</div>}
    </>
  );
}

function watchScrolling() {
  const calls: ScrollIntoViewOptions[] = [];
  const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ) {
    calls.push((options ?? {}) as ScrollIntoViewOptions);
  });
  return { calls, restore: () => spy.mockRestore() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("useScrollIntoViewWhen", () => {
  test("stays put until the thing it guards is actually revealed", async () => {
    const { calls, restore } = watchScrolling();
    try {
      render(<Revealing />);
      await settle();
      expect(calls).toHaveLength(0);

      document.querySelector("button")?.click();
      await settle();
      expect(calls).toHaveLength(1);
      // Moving the minimum keeps a control already on screen where it was.
      expect(calls[0]?.block).toBe("nearest");
    } finally {
      restore();
    }
  });

  test("does not drag the page back on the way down", async () => {
    const { calls, restore } = watchScrolling();
    try {
      render(<Revealing start />);
      await settle();
      expect(calls).toHaveLength(1);

      document.querySelector("button")?.click();
      await settle();
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
