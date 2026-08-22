// The factory reset is the one irreversible thing in this panel, and it has two
// ways to reach the router. What is held here is the gate: that it cannot be
// armed with nothing to send through, and that a router off the LAN is reset
// through the account rather than by dialling an address nothing answers on.

import { expect, describe, test, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import type { RouterUnreachable } from "../../lib/routerDiagnosis";
import { RouterSettingsTab } from "./RouterSettingsTab";

const applyRouterConfigUpdate = vi.fn().mockResolvedValue(undefined);
const loadDish = vi.fn();
let accountStatus: "loading" | "ready" | "not-connected" | "error" = "not-connected";

vi.mock("../../hooks/useCloudAccount", () => ({
  useCloudAccount: () => ({ data: null, status: accountStatus, reload: vi.fn() }),
  useCloudRouterSubnet: () => ({ data: null, status: accountStatus, reload: vi.fn() }),
}));

vi.mock("../../lib/routerConfigUpdate", () => ({
  applyRouterConfigUpdate: (...args: unknown[]) => applyRouterConfigUpdate(...args),
  AccountRequiredError: class AccountRequiredError extends Error {},
  DeviceUnreachableError: class DeviceUnreachableError extends Error {},
}));

vi.mock("@core/dishClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DishClient: { load: (...args: unknown[]) => loadDish(...args) },
}));

afterEach(cleanup);
beforeEach(() => {
  applyRouterConfigUpdate.mockClear();
  loadDish.mockClear();
  accountStatus = "not-connected";
});

const SILENT: RouterUnreachable = { cause: "noRouter", message: "No router on this kit." };
const TRACK_INSET_PX = 3;

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

/** Carries the named handle the whole way across its track and lets go. */
function slide(label: string) {
  const grip = document.querySelector(`[data-slide-handle][aria-label="${label}"]`) as HTMLElement;
  const rail = grip.closest("[data-slide-track]") as HTMLElement;
  const start = grip.getBoundingClientRect();
  const travel = rail.clientWidth - start.width - TRACK_INSET_PX * 2;
  const from = start.left + start.width / 2;

  grip.setPointerCapture = () => {};
  grip.releasePointerCapture = () => {};
  grip.dispatchEvent(new PointerEvent("pointerdown", { clientX: from, bubbles: true }));
  grip.dispatchEvent(
    new PointerEvent("pointermove", { clientX: from + travel * 1.2, bubbles: true }),
  );
  grip.dispatchEvent(
    new PointerEvent("pointerup", { clientX: from + travel * 1.2, bubbles: true }),
  );
}

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** A router that answers nothing on the LAN, which is every bypassed kit. */
function mountWithSilentRouter() {
  render(
    <RouterSettingsTab
      wifiConfig={null}
      dishStatus={null}
      routerReachable={false}
      viaAccount={false}
      unreachable={SILENT}
      onConfigChanged={vi.fn()}
    />,
  );
}

describe("RouterSettingsTab factory reset", () => {
  test("cannot be armed when neither the LAN nor an account can carry it", async () => {
    accountStatus = "not-connected";
    mountWithSilentRouter();
    await settle();

    expect(text()).toContain("Needs the router on this network, or your Starlink account");
    expect(button("Factory reset").disabled).toBe(true);

    button("Factory reset").click();
    await settle();
    // Still nothing to confirm: arming is what the gate refuses.
    expect(document.querySelector("[data-slide-handle]")).toBeNull();
    expect(applyRouterConfigUpdate).not.toHaveBeenCalled();
  });

  test("resets a router off the LAN through the account rather than dialling it", async () => {
    accountStatus = "ready";
    mountWithSilentRouter();
    await settle();

    expect(button("Factory reset").disabled).toBe(false);
    button("Factory reset").click();
    await settle();

    slide("Slide to factory reset the router");
    await settle();

    // The slide only opens the confirm; nothing is sent until it is accepted.
    expect(applyRouterConfigUpdate).not.toHaveBeenCalled();
    button("Factory reset router").click();
    await settle();

    expect(applyRouterConfigUpdate).toHaveBeenCalledWith({ kind: "factoryReset" });
    // The address it would dial answers nothing; that is why this path exists.
    expect(loadDish).not.toHaveBeenCalled();
  });
});
