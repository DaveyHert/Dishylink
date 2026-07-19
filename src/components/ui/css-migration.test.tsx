// Conversion harness for the bulk CSS -> Tailwind migration.
//
// Each row pairs a legacy class with the utilities meant to replace it. The test renders
// both and requires every resolved style to match. That is what "no guess game" means
// mechanically: if a utility resolves to 12px where the CSS said 13px, this fails —
// before the swap reaches a component.
//
// Workflow: add a row, watch it pass, apply the utilities in the component, delete the
// CSS rule. Once a rule is deleted its row will fail (the legacy side goes unstyled), so
// rows are removed as their rules die — the table only ever holds pending conversions.
//
// Limits, stated so nobody trusts this further than it goes:
//  - :hover / descendant selectors (.netrow-offline .netrow-name) are NOT covered.
//  - Context-dependent values (flex children, inherited font) need the parent supplied.

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";

const PROPS = [
  "display", "flex-direction", "align-items", "justify-content", "gap", "flex-grow", "flex-shrink", "flex-basis",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "min-width", "min-height", "max-width", "max-height",
  "color", "background-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-color", "border-top-style",
  "border-top-left-radius", "border-bottom-right-radius",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "text-align", "text-overflow", "font-variant-numeric", "text-transform", "white-space", "overflow-x", "overflow-y", "cursor", "opacity",
] as const;

interface Conversion {
  /** Legacy class from index.css. */
  css: string;
  /** Tailwind utilities intended to replace it, exactly. */
  tw: string;
  /** Wrapper when the value depends on context (e.g. a flex child). */
  wrap?: string;
}

const CONVERSIONS: Conversion[] = [
  // Retired (converted, applied, CSS deleted): netrow-*, devdetail-*, mono-value,
  // stat-caption, micro-label, info-label.
];

describe.skipIf(CONVERSIONS.length === 0)("CSS -> Tailwind conversions resolve identically", () => {
  test.each(CONVERSIONS)("$css", async ({ css, tw, wrap }) => {
    render(
      <>
        <div className={wrap}>
          <div className={css} data-testid="legacy">
            x
          </div>
        </div>
        <div className={wrap}>
          <div className={tw} data-testid="migrated">
            x
          </div>
        </div>
      </>,
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    const legacy = document.querySelector("[data-testid='legacy']");
    const migrated = document.querySelector("[data-testid='migrated']");
    expect(legacy, `.${css} should render`).not.toBeNull();
    expect(migrated, "migrated element should render").not.toBeNull();

    const a = getComputedStyle(legacy!);
    const b = getComputedStyle(migrated!);
    const drift: string[] = [];
    for (const prop of PROPS) {
      const before = a.getPropertyValue(prop);
      const after = b.getPropertyValue(prop);
      if (before !== after) drift.push(`${prop}: "${before}" -> "${after}"`);
    }
    expect(drift, `.${css} does not match its utilities`).toEqual([]);
  });
});
