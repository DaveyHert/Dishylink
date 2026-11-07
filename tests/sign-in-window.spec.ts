/**
 * Playwright end-to-end tests for the Electron sign-in window.
 *
 * What it covers:
 *   1. Triggering sign-in opens a second BrowserWindow at starlink.com.
 *   2. That window runs in an isolated session partition (not the default).
 *   3. Its webPreferences have contextIsolation=true, sandbox=true,
 *      nodeIntegration=false — confirmed via getLastWebPreferences().
 *   4. setWindowOpenHandler blocks window.open() — no popup escapes.
 *   5. Closing the login window without signing in leaves the main window alive.
 *
 * No real Starlink credentials are required.
 *
 * Run:
 *   npm run build:electron
 *   npx playwright test --config=playwright.config.ts
 */

import { test, expect, _electron as electron } from "playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const MAIN_JS = path.join(repoRoot, "dist-electron", "main.js");

// ─── types ───────────────────────────────────────────────────────────────────

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>;

interface WebPrefs {
  contextIsolation: boolean;
  sandbox: boolean;
  nodeIntegration: boolean;
  partition: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Fire the "starlink-signin" ipcMain handler synthetically, exactly as the
 * renderer does via ipcRenderer.invoke("starlink-signin"). Uses the internal
 * _invokeHandlers map — the only stable way to call it without a live renderer.
 */
function triggerSignIn(app: ElectronApp): void {
  // Fire and forget — openLoginWindow only resolves when the window closes,
  // so we must not await it here.
  void app.evaluate(({ ipcMain, BrowserWindow }) => {
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
      }
    )._invokeHandlers.get("starlink-signin");

    if (!handler) throw new Error('"starlink-signin" handler not registered');

    // Pass a fake IPC event whose .sender is the main window's webContents,
    // matching what the real preload bridge sends.
    const mainWin = BrowserWindow.getAllWindows()[0];
    void handler({ sender: mainWin.webContents }, undefined);
  });
}

/**
 * Poll until a Playwright Page whose URL matches the predicate exists, or
 * throw after `ms` milliseconds.
 */
async function waitForWindow(
  app: ElectronApp,
  predicate: (url: string) => boolean,
  ms = 25_000,
): Promise<Awaited<ReturnType<ElectronApp["firstWindow"]>>> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (predicate(w.url())) return w;
      } catch {
        // Window may be mid-navigation — try next iteration.
      }
    }
    await new Promise<void>((r) => setTimeout(r, 400));
  }
  const open = app
    .windows()
    .map((w) => { try { return w.url(); } catch { return "(destroyed)"; } })
    .join(", ");
  throw new Error(`No matching window after ${ms} ms. Open: [${open}]`);
}

/** Read the login window's security properties from the main process. */
async function getLoginWindowPrefs(app: ElectronApp): Promise<WebPrefs | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => {
      try {
        return w.webContents.getURL().includes("starlink.com");
      } catch {
        return false;
      }
    });
    if (!win) return null;

    // getLastWebPreferences() gives us the resolved contextIsolation/sandbox/nodeIntegration.
    // The partition doesn't surface there — read it from the session's storagePath instead.
    const prefs = win.webContents.getLastWebPreferences();
    return {
      contextIsolation: prefs?.contextIsolation ?? false,
      sandbox: prefs?.sandbox ?? false,
      nodeIntegration: prefs?.nodeIntegration ?? true,
      // storagePath is e.g. ".../Partitions/starlink-login" for a named partition,
      // or the default user-data-dir for the default session.
      partition: win.webContents.session.storagePath ?? "",
    };
  });
}

// ─── setup ───────────────────────────────────────────────────────────────────

// All tests share a common launch/teardown pattern. We use test.describe with
// individual app instances so each test is fully isolated.

// ─── tests ───────────────────────────────────────────────────────────────────

test.describe("Login window security (fix/login-window)", () => {
  test("opens a login window pointing at starlink.com", async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    try {
      const main = await app.firstWindow();
      await main.waitForLoadState("domcontentloaded");

      triggerSignIn(app);

      const loginWindow = await waitForWindow(app, (url) =>
        url.includes("starlink.com"),
      );

      expect(loginWindow.url()).toMatch(/starlink\.com/);
      console.log("  ✓ login url:", loginWindow.url());
    } finally {
      await app.close();
    }
  });

  test("login window runs in an isolated session partition", async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    try {
      const main = await app.firstWindow();
      await main.waitForLoadState("domcontentloaded");

      triggerSignIn(app);
      await waitForWindow(app, (url) => url.includes("starlink.com"));

      const prefs = await getLoginWindowPrefs(app);
      expect(prefs).not.toBeNull();

      // The partition must be the dedicated login partition, not the default.
      expect(prefs!.partition).toMatch(/starlink-login/);
      console.log("  ✓ partition:", prefs!.partition);
    } finally {
      await app.close();
    }
  });

  test("login window has contextIsolation=true, sandbox=true, nodeIntegration=false", async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    try {
      const main = await app.firstWindow();
      await main.waitForLoadState("domcontentloaded");

      triggerSignIn(app);
      await waitForWindow(app, (url) => url.includes("starlink.com"));

      const prefs = await getLoginWindowPrefs(app);
      expect(prefs).not.toBeNull();

      expect(prefs!.contextIsolation).toBe(true);
      expect(prefs!.sandbox).toBe(true);
      expect(prefs!.nodeIntegration).toBe(false);

      console.log("  ✓ contextIsolation:", prefs!.contextIsolation);
      console.log("  ✓ sandbox:", prefs!.sandbox);
      console.log("  ✓ nodeIntegration:", prefs!.nodeIntegration);
    } finally {
      await app.close();
    }
  });

  test("window.open() inside the login page is blocked (setWindowOpenHandler)", async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    try {
      const main = await app.firstWindow();
      await main.waitForLoadState("domcontentloaded");

      triggerSignIn(app);

      const loginWindow = await waitForWindow(app, (url) =>
        url.includes("starlink.com"),
      );

      const countBefore = app.windows().length;

      // Attempt to spawn a popup from inside the login page.
      // webContents.setWindowOpenHandler({ action: "deny" }) must suppress it.
      await loginWindow.evaluate(() => {
        window.open("https://example.com", "_blank");
      });

      // Give Electron a moment to process the new-window event.
      await loginWindow.waitForTimeout(1_200);

      const countAfter = app.windows().length;
      expect(countAfter).toBe(countBefore);
      console.log(
        `  ✓ popup blocked — windows before: ${countBefore}, after: ${countAfter}`,
      );
    } finally {
      await app.close();
    }
  });

  test("closing the login window without signing in leaves the main window alive", async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    try {
      const main = await app.firstWindow();
      await main.waitForLoadState("domcontentloaded");

      triggerSignIn(app);

      const loginWindow = await waitForWindow(app, (url) =>
        url.includes("starlink.com"),
      );

      // Dismiss without signing in.
      await loginWindow.close();
      await main.waitForTimeout(600);

      // Main window must still be open and responsive.
      const survivingUrls = app
        .windows()
        .map((w) => { try { return w.url(); } catch { return "(destroyed)"; } });

      expect(survivingUrls.some((u) => u.includes("bundle"))).toBe(true);

      const readyState = await main.evaluate(() => document.readyState);
      expect(["interactive", "complete"]).toContain(readyState);

      console.log("  ✓ main window alive:", survivingUrls);
    } finally {
      await app.close();
    }
  });
});
