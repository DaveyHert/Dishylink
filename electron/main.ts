// The Electron main process — the app's one privileged host. It owns the window,
// the tray, and the collector (the historian, run in-process). The renderer is
// sandboxed and reaches this side only through the preload bridge: there is no
// localhost port, so nothing on the machine but this app can reach the dish data
// or cloud session.
//
// Lifecycle: the app is a background recorder with a window, not a window with a
// background job. Closing the window releases the renderer but leaves the collector
// running in the tray; the app quits only when the user chooses Quit.

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { registerAppProtocolScheme, handleAppProtocol, APP_ENTRY_URL } from "./appProtocol";
import { startCollector, handleApiRequest } from "./collector";
import { startCloud, handleCloudRequest, signIn } from "./cloud";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "../dist");
const iconPath = join(here, "../build/icon.png");

// Name the app before anything reads it — it drives the menu-bar title and the
// per-app data directory. The macOS dock-hover tooltip comes from the bundle
// itself, so it only reflects this once the app is packaged.
app.setName("DishyLink");

// Declaring the app:// scheme must happen before the app is ready, so it runs at
// module load rather than inside whenReady.
registerAppProtocolScheme();

// vite-plugin-electron sets this while `vite` is serving; it is absent in a
// packaged build, where the renderer is loaded over app:// instead.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 980,
    // Below this the dashboard's tiles and charts stop being usable; the app's
    // responsive layout still adapts down to it.
    minWidth: 700,
    minHeight: 600,
    // The desktop window keeps this fixed title; the shared page <title> is the
    // neutral "Starlink Companion (Unofficial)" that the browser and extension use.
    title: "DishyLink — Starlink Companion Desktop App (Unofficial)",
    // Drop the macOS title-bar band so the app's own background reaches the top
    // edge; the traffic lights stay, inset, floating over it. The renderer reserves
    // room for them and makes the top bar draggable (see the data-host rules).
    titleBarStyle: "hiddenInset",
    // Paint nothing until the app has rendered, so there is no white flash.
    show: false,
    webPreferences: {
      preload: join(here, "preload.mjs"),
      // The renderer runs untrusted web code and must not touch Node or Electron
      // internals directly; the preload bridge is the only crossing.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep the fixed window title above; without this the page's <title> replaces it.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Closing the window frees the renderer; the collector keeps running in the tray.
  // Reopening builds a fresh window.
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(devServerUrl ?? APP_ENTRY_URL);
}

/** Bring the window forward, building it if the last one was closed. */
function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 18, height: 18 }));
  tray.setToolTip("DishyLink");
  const menu = Menu.buildFromTemplate([
    { label: "Open DishyLink", click: showWindow },
    { type: "separator" },
    {
      // A login launch stays in the tray with no window (openAsHidden, plus the
      // wasOpenedAtLogin check below), so booting the machine starts background
      // collection with no window shown.
      label: "Start at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: "separator" },
    { label: "Quit DishyLink", role: "quit" },
  ]);
  // Left click opens the app; right click shows the menu. Attaching the menu with
  // setContextMenu would make a left click open the menu too (macOS), so it is
  // popped up on right click instead.
  tray.on("click", showWindow);
  tray.on("right-click", () => tray?.popUpContextMenu(menu));
}

/**
 * On the first packaged run, start the app with the machine — a background recorder
 * that only runs when the app is open would miss exactly the outages a user cares
 * about. The tray's "Open at Login" controls it from then on.
 *
 * A dev run is never packaged; it must not leave a login item pointing at
 * node_modules/electron, so there it only clears any such entry.
 */
function configureLoginItem(): void {
  if (!app.isPackaged) {
    // macOS refuses login-item changes for a non-bundled app, so only attempt the
    // clear when there is actually an entry to remove.
    if (app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  const marker = join(app.getPath("userData"), ".setup-done");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {
    // Non-fatal: it just means we re-offer the default next launch.
  }
}

/**
 * The account session: the sign-in window, and the renderer's /cloud/* calls
 * carried over IPC rather than over its own origin.
 *
 * A packaged window loads over app:// and could fetch those routes directly, but
 * a dev-server window cannot — Vite's origin has its own binding, with its own
 * session file. Handing both windows to the same handler gives the desktop app
 * one account session however it was launched. The payload stays plain JSON so
 * the browser extension can reuse the shape over chrome.runtime messaging.
 */
function registerCloudHandlers(): void {
  ipcMain.handle("starlink-signin", (event) =>
    signIn(BrowserWindow.fromWebContents(event.sender) ?? undefined),
  );
  ipcMain.handle(
    "cloud-request",
    async (
      _event,
      { path, method = "GET", body }: { path: string; method?: string; body?: unknown },
    ) => {
      // This bridge exists for the cloud routes alone; it must not become a way
      // for the renderer to reach anything else the main process can answer.
      if (!path.startsWith("/cloud/")) return { status: 404, body: { error: "not_found" } };
      // handleCloudRequest routes on the pathname alone, so the origin here only
      // makes the URL absolute. Nothing dials it.
      const request = new Request(new URL(path, "http://desktop.invalid").toString(), {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const response = await handleCloudRequest(request);
      return { status: response.status, body: await response.json() };
    },
  );
}

/**
 * Desktop notifications, posted from here rather than from the renderer.
 *
 * The window loads over app://, and a sandboxed renderer on a custom origin
 * cannot get web notification permission granted — which left the app unable to
 * notify at all, and its "Enable notifications" control unable to ever report
 * itself on. Main talks to the OS directly, so there is no web permission in the
 * way; macOS asks once for DishyLink itself, as it does for any native app.
 *
 * Clicking one raises the window: a notification about the dish is only useful
 * if it can take you to the dashboard showing why.
 */
/**
 * Why the OS would not post, phrased for the person who clicked enable. A
 * packaged, signed app that is refused has simply been switched off in System
 * Settings. An unsigned dev run is refused whatever that switch says, because
 * macOS will not post for a binary it cannot verify — the "Electron" entry reads
 * as allowed and the notification still fails. Naming the real cause keeps the
 * toggle from sending someone to a switch that is already on.
 */
function undeliverableReason(): string {
  return app.isPackaged
    ? "macOS isn’t delivering notifications — allow DishyLink under System Settings ▸ Notifications."
    : "Native notifications need the installed DishyLink app; a dev run can’t post them.";
}

function registerNotificationHandler(): void {
  ipcMain.handle("notify", async (_event, { title, body }: { title: string; body: string }) => {
    if (!Notification.isSupported()) return { delivered: false, reason: undeliverableReason() };
    const notification = new Notification({ title, body });
    notification.on("click", showWindow);
    // Whether it actually reached the user, not merely that we asked — and why
    // not when it didn't, since only here is the packaged-vs-unsigned distinction
    // known. The renderer needs the truth so its toggle cannot report itself on
    // while nothing is being delivered.
    return new Promise<{ delivered: boolean; reason?: string }>((resolve) => {
      let settled = false;
      const settle = (delivered: boolean) => {
        if (settled) return;
        settled = true;
        resolve(
          delivered ? { delivered: true } : { delivered: false, reason: undeliverableReason() },
        );
      };
      notification.on("show", () => settle(true));
      notification.on("failed", () => settle(false));
      notification.show();
      // Not every platform emits `show`; assume success rather than disable a
      // working channel over a missing event.
      setTimeout(() => settle(true), 1_500);
    });
  });
}

void app.whenReady().then(async () => {
  // An unpackaged run shows Electron's default icon; set ours on the macOS dock.
  // A packaged build carries the icon in its bundle, so this only applies in dev.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  // The cloud account is a property of this host, not of packaging: the session
  // belongs in the keychain and the sign-in window is ours to open, in a dev run
  // exactly as in a packaged one. It is bound before the window loads so the
  // renderer's first /cloud/* call has somewhere to land.
  startCloud();
  registerCloudHandlers();
  // Only the packaged app serves itself: the collector runs in this process and
  // app:// answers /api. In dev the Vite server proxies /api to the dev historian,
  // so starting a second collector here would just double-poll the dish.
  if (!devServerUrl) {
    await startCollector(rendererRoot);
    handleAppProtocol(rendererRoot, handleApiRequest, handleCloudRequest);
    configureLoginItem();
  }
  // Registered for dev and packaged runs alike: notifications are the app's
  // alerting channel, not a packaging feature.
  registerNotificationHandler();
  createTray();
  // A normal launch opens the window; a launch the login item triggered stays in
  // the background (tray only), so booting the machine doesn't pop a window.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createWindow();
});

// The app lives in the tray after its window closes, so background collection keeps
// running — it quits only via the tray's Quit. Hence no quit on window-all-closed.
app.on("window-all-closed", () => {});

app.on("activate", showWindow);
