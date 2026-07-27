// The Electron main process — the app's one privileged host. It owns the window,
// the tray, and the collector (the historian, run in-process). The renderer is
// sandboxed and reaches this side only through the preload bridge: there is no
// localhost port, so nothing on the machine but this app can reach the dish data
// or cloud session.
//
// Lifecycle: the app is a background recorder with a window, not a window with a
// background job. Closing the window releases the renderer but leaves the collector
// running in the tray; the app quits only when the user chooses Quit.

import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { registerAppProtocolScheme, handleAppProtocol, APP_ENTRY_URL } from "./appProtocol";
import { startCollector, handleApiRequest } from "./collector";

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
    width: 1280,
    height: 860,
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
      label: "Open at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      // openAsHidden starts it in the background (tray only) at boot.
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
    app.setLoginItemSettings({ openAtLogin: false });
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

void app.whenReady().then(async () => {
  // An unpackaged run shows Electron's default icon; set ours on the macOS dock.
  // A packaged build carries the icon in its bundle, so this only applies in dev.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  // Only the packaged app serves itself: the collector runs in this process and
  // app:// answers /api. In dev the Vite server proxies /api to the dev historian,
  // so starting a second collector here would just double-poll the dish.
  if (!devServerUrl) {
    await startCollector(rendererRoot);
    handleAppProtocol(rendererRoot, handleApiRequest);
    configureLoginItem();
  }
  createTray();
  // A normal launch opens the window; a launch the login item triggered stays in
  // the background (tray only), so booting the machine doesn't pop a window.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createWindow();
});

// The app lives in the tray after its window closes, so background collection keeps
// running — it quits only via the tray's Quit. Hence no quit on window-all-closed.
app.on("window-all-closed", () => {});

app.on("activate", showWindow);
