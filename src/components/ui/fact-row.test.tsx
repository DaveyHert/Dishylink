import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { FactGrid, FactRow } from "./fact-row";

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

describe("FactRow / FactGrid match the old .device-row / .device-grid design", () => {
  test("row layout", async () => {
    render(
      <FactGrid>
        <FactRow label="Azimuth">
          <span>12.4°</span>
        </FactRow>
      </FactGrid>,
    );
    const row = await waitFor(() => document.querySelector("[data-slot='fact-row']"), "row");
    const style = getComputedStyle(row);
    // .device-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--hairline) }
    expect(style.display).toBe("flex");
    expect(style.justifyContent).toBe("space-between");
    expect(style.alignItems).toBe("baseline");
    expect(style.columnGap).toBe("16px");
    expect(style.paddingTop).toBe("7px");
    expect(style.paddingBottom).toBe("7px");
    expect(style.borderBottomWidth).toBe("1px");
    expect(style.borderBottomColor).toBe(tokenColor("--hairline"));
  });

  test("label typography", async () => {
    render(
      <FactGrid>
        <FactRow label="Azimuth">
          <span>12.4°</span>
        </FactRow>
      </FactGrid>,
    );
    const label = await waitFor(() => document.querySelector("[data-slot='fact-label']"), "label");
    const style = getComputedStyle(label);
    // .device-row .device-label { font-size: 13px; font-weight: 500; color: var(--ink-muted); flex: none }
    expect(style.fontSize).toBe("13px");
    expect(style.fontWeight).toBe("500");
    expect(style.color).toBe(tokenColor("--ink-muted"));
    expect(style.flexGrow).toBe("0");
    expect(style.flexShrink).toBe("0");
  });

  test("grid is a two-column-by-default grid with the device-grid gaps", async () => {
    render(
      <FactGrid>
        <FactRow label="A">
          <span>1</span>
        </FactRow>
      </FactGrid>,
    );
    const grid = await waitFor(() => document.querySelector("[data-slot='fact-grid']"), "grid");
    const style = getComputedStyle(grid);
    // .device-grid { display: grid; gap: 4px 32px }  (row-gap 4px, column-gap 32px)
    expect(style.display).toBe("grid");
    expect(style.rowGap).toBe("4px");
    expect(style.columnGap).toBe("32px");
  });
});
