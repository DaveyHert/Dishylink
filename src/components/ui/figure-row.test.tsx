import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { FigureRow } from "./figure-row";

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

const FIGURES = [
  { value: "10.5", unit: "Mbps", label: "Average" },
  { value: "36", unit: "kbps", label: "Current" },
];

describe("FigureRow matches the .detail-figure* design", () => {
  test("row layout", async () => {
    render(<FigureRow figures={FIGURES} />);
    const row = await waitFor(() => document.querySelector("[data-slot='figure-row']"), "row");
    const style = getComputedStyle(row);
    // .detail-figures { display: flex; align-items: center; gap: 28px; margin: 12px 0 14px }
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("center");
    expect(style.columnGap).toBe("28px");
    expect(style.marginTop).toBe("12px");
    expect(style.marginBottom).toBe("14px");
  });

  test("value, unit and label typography", async () => {
    render(<FigureRow figures={FIGURES} />);
    const figure = await waitFor(() => document.querySelector("[data-slot='figure']"), "figure");
    const value = getComputedStyle(figure.firstElementChild!);
    // .detail-figure-value { font-size: 36px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.05 }
    expect(value.fontSize).toBe("36px");
    expect(value.fontWeight).toBe("700");
    expect(value.lineHeight).toBe("37.8px"); // 36 * 1.05

    const unit = getComputedStyle(figure.querySelector("span")!);
    // .detail-figure-unit { font-size: 14px; font-weight: 500; color: var(--ink-muted); margin-left: 5px }
    expect(unit.fontSize).toBe("14px");
    expect(unit.fontWeight).toBe("500");
    expect(unit.marginLeft).toBe("5px");
    expect(unit.color).toBe(tokenColor("--ink-muted"));

    const label = getComputedStyle(figure.lastElementChild!);
    // .detail-figure-label { font-size: 12px; font-weight: 500; color: var(--ink-muted); margin-top: 2px }
    expect(label.fontSize).toBe("12px");
    expect(label.marginTop).toBe("2px");
    expect(label.color).toBe(tokenColor("--ink-muted"));
  });

  test("the row places dividers BETWEEN figures — never leading or trailing", async () => {
    render(<FigureRow figures={[...FIGURES, { value: "17.1", unit: "GB", label: "Total" }]} />);
    await waitFor(() => document.querySelector("[data-slot='figure-row']"), "row");
    // 3 figures => exactly 2 dividers. Callers used to place these by hand.
    expect(document.querySelectorAll("[data-slot='figure']").length).toBe(3);
    expect(document.querySelectorAll("[data-slot='figure-divider']").length).toBe(2);

    const divider = getComputedStyle(document.querySelector("[data-slot='figure-divider']")!);
    // .detail-figure-divider { width: 1px; align-self: stretch; background: var(--hairline) }
    expect(divider.width).toBe("1px");
    expect(divider.alignSelf).toBe("stretch");
    // bg-border is exact: @theme declares --color-border: var(--hairline).
    expect(divider.backgroundColor).toBe(tokenColor("--hairline"));
  });

  test("a single figure gets no divider", async () => {
    render(<FigureRow figures={[FIGURES[0]]} />);
    await waitFor(() => document.querySelector("[data-slot='figure-row']"), "row");
    expect(document.querySelectorAll("[data-slot='figure-divider']").length).toBe(0);
  });
});
