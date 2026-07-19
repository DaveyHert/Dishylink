// Design-fidelity contract for the app's drill-down sheet.
//
// Every expected value is copied from the ORIGINAL hand-written rules in src/index.css
// (.detail-overlay / .detail-sheet / .detail-header / .detail-title / .detail-close).
// They are the spec — not a snapshot of whatever currently renders.
//
// This runs against BOTH implementations: the hand-rolled SheetModal and the Radix-based
// DetailSheet that replaces it. Same assertions, both green = the swap changed nothing
// visible. That is the whole point.
//
// Why assert by role and not by class: the migration DELETES the classes. A gate keyed
// on `.detail-sheet` can only report "GONE" once converted — it cannot tell "preserved"
// from "broken". role="dialog" survives the swap; the class does not.

import { expect, describe, test } from "vitest";
import { render } from "vitest-browser-react";
import { DetailsModal } from "./details-modal";

/**
 * Poll rather than sleep a guessed duration. React 19 commits asynchronously and Radix
 * mounts through a portal, so the two implementations appear on different ticks — a
 * fixed 50ms passed for the hand-rolled sheet and silently failed the Radix one.
 */
async function waitFor<T>(get: () => T | null, what: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// These assertions ran green against the old hand-rolled SheetModal AND against
// DetailsModal before SheetModal was deleted — that is how the swap was proven
// invisible. SheetModal is now gone; the same values keep guarding DetailsModal.
const IMPLEMENTATIONS = [["DetailsModal (Radix)", DetailsModal]] as const;

describe.each(IMPLEMENTATIONS)("%s", (_name, Modal) => {
  async function mount(size?: "default" | "wide" | "xl" | "xxl") {
    render(
      <Modal title="Speed test" onClose={() => {}} size={size}>
        <p>body</p>
      </Modal>,
    );
    const modal = await waitFor(() => document.querySelector('[role="dialog"]'), "role=dialog");
    return { modal: modal as HTMLElement, overlay: modal.parentElement as HTMLElement };
  }

  test("backdrop matches .detail-overlay exactly", async () => {
    const { overlay } = await mount();
    const style = getComputedStyle(overlay);
    expect(style.position).toBe("fixed");
    expect(style.zIndex).toBe("50");
    // background: rgba(0, 0, 0, 0.55) — bg-black/55 resolves to this exact string.
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0.55)");
    // blur(5px) — NOT backdrop-blur-sm, which is 4px.
    expect(style.backdropFilter).toBe("blur(5px)");
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("flex-start");
    expect(style.justifyContent).toBe("center");
    expect(style.overflowY).toBe("auto");
    // padding: 6vh 20px 40px
    expect(style.paddingRight).toBe("20px");
    expect(style.paddingLeft).toBe("20px");
    expect(style.paddingBottom).toBe("40px");
  });

  test("panel matches .detail-sheet exactly", async () => {
    const { modal } = await mount();
    const style = getComputedStyle(modal);
    // background: var(--surface). bg-card is an exact substitute ONLY because
    // index.css declares `--color-card: var(--surface)` in @theme inline.
    const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    expect(style.backgroundColor).toBe(hexToRgb(surface));
    // border-radius: 18px — no Tailwind scale step is 18px, so rounded-[18px].
    expect(style.borderTopLeftRadius).toBe("18px");
    expect(style.borderTopRightRadius).toBe("18px");
    expect(style.borderBottomLeftRadius).toBe("18px");
    expect(style.borderBottomRightRadius).toBe("18px");
    // padding: 20px 22px 22px
    expect(style.paddingTop).toBe("20px");
    expect(style.paddingRight).toBe("22px");
    expect(style.paddingBottom).toBe("22px");
    expect(style.paddingLeft).toBe("22px");
    expect(style.boxShadow).toBe("rgba(0, 0, 0, 0.45) 0px 24px 80px 0px");
  });

  test.each([
    ["default", "680px"],
    ["wide", "780px"],
    ["xl", "920px"],
    ["xxl", "1080px"],
  ] as const)("size %s => width min(%s, 100%%)", async (size, expected) => {
    const { modal } = await mount(size);
    // width: min(Npx, 100%). The used value depends on viewport, so assert the
    // resolved width is capped at N — the cap is the authored intent.
    const width = Number.parseFloat(getComputedStyle(modal).width);
    expect(width).toBeLessThanOrEqual(Number.parseFloat(expected));
  });

  test("header, title and close match .detail-header/.detail-title/.detail-close", async () => {
    const { modal } = await mount();
    const title = modal.querySelector(".detail-title") ?? modal.querySelector("[data-slot='details-modal-title']");
    expect(title, "title should render").not.toBeNull();
    const titleStyle = getComputedStyle(title!);
    expect(titleStyle.fontSize).toBe("19px");
    expect(titleStyle.fontWeight).toBe("700");

    const close = modal.querySelector('[aria-label="Close"]');
    expect(close, "close control should render and be labelled").not.toBeNull();
    const closeStyle = getComputedStyle(close!);
    expect(closeStyle.width).toBe("30px");
    expect(closeStyle.height).toBe("30px");
    // border-radius: 999px. rounded-full computes 9999px — a different value.
    expect(closeStyle.borderTopLeftRadius).toBe("999px");
    expect(closeStyle.marginLeft).not.toBe("0px"); // margin-left: auto pushes it right
  });
});

/** #rrggbb -> "rgb(r, g, b)" as getComputedStyle reports it. */
function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
