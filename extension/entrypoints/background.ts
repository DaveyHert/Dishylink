import { defineBackground } from "#imports";
import { browser } from "wxt/browser";

// The toolbar icon opens the full manager page, never a toolbar-anchored dropdown
// (the dashboard is chart-heavy and wants room). Two user-selectable surfaces:
// a chromeless standalone window (default) or an ordinary tab. With no
// default_popup in the manifest, action.onClicked fires and branches here.
const MANAGER_PATH = "/manager.html";
const SURFACE_KEY = "surface";
const WINDOW_BOUNDS_KEY = "managerWindowBounds";

type Surface = "window" | "tab";
type Bounds = { top: number; left: number; width: number; height: number };

const DEFAULT_BOUNDS: Bounds = { top: 80, left: 120, width: 1200, height: 800 };

// The single open manager window, so a second click focuses it instead of
// opening another. Held in memory; the browser clears the worker's memory on
// teardown, but a stale id is re-validated against browser.windows before use.
let managerWindowId: number | undefined;

async function readSurface(): Promise<Surface> {
  const stored = await browser.storage.local.get(SURFACE_KEY);
  return stored[SURFACE_KEY] === "tab" ? "tab" : "window";
}

async function openManagerWindow(): Promise<void> {
  if (managerWindowId !== undefined) {
    try {
      await browser.windows.update(managerWindowId, { focused: true });
      return;
    } catch {
      // The remembered window was closed; fall through and open a fresh one.
      managerWindowId = undefined;
    }
  }
  const stored = await browser.storage.local.get(WINDOW_BOUNDS_KEY);
  const bounds = (stored[WINDOW_BOUNDS_KEY] as Bounds | undefined) ?? DEFAULT_BOUNDS;
  const created = await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL(MANAGER_PATH),
    ...bounds,
  });
  managerWindowId = created?.id;
}

async function openManagerTab(): Promise<void> {
  const url = browser.runtime.getURL(MANAGER_PATH);
  const existing = await browser.tabs.query({ url });
  if (existing[0]?.id !== undefined) {
    await browser.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId !== undefined)
      await browser.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url });
}

async function openManager(): Promise<void> {
  if ((await readSurface()) === "tab") await openManagerTab();
  else await openManagerWindow();
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => void openManager());

  // Saved bounds are restored on the next open, so the window returns where the
  // user left it. Only the manager window's own moves and resizes are tracked.
  const rememberBounds = (windowId: number) => {
    if (windowId !== managerWindowId) return;
    void browser.windows.get(windowId).then((win) => {
      if (win.top == null || win.left == null || win.width == null || win.height == null) return;
      void browser.storage.local.set({
        [WINDOW_BOUNDS_KEY]: { top: win.top, left: win.left, width: win.width, height: win.height },
      });
    });
  };
  browser.windows.onBoundsChanged?.addListener((win) => {
    if (win.id !== undefined) rememberBounds(win.id);
  });
  browser.windows.onRemoved.addListener((windowId) => {
    if (windowId === managerWindowId) managerWindowId = undefined;
  });

  // The drain runs off a chrome.alarms tick so it survives service-worker
  // teardown — the alarm re-wakes the worker. The tick's handler (poll the dish
  // through core/, drain past the persisted cursor, upsert IndexedDB) lands next.
  browser.alarms.create("drain", { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "drain") {
      // Drain binding pending — see extension/lib (task 3).
    }
  });
});
