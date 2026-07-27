// The Electron main process — the app's one privileged host. It owns the window
// today, and (as later steps land) the collector, the dish/router/cloud transport,
// and the Starlink sign-in. The renderer is sandboxed and reaches this side only
// through the typed bridge in preload.ts: there is no localhost port, so nothing on
// the machine but this app can reach the user's dish data or cloud session.

import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerAppProtocolScheme, handleAppProtocol, APP_ENTRY_URL } from "./appProtocol";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "../dist");

// Declaring the app:// scheme must happen before the app is ready, so it runs at
// module load rather than inside whenReady.
registerAppProtocolScheme();

// vite-plugin-electron sets this while `vite` is serving; it is absent in a
// packaged build, where the renderer is loaded over app:// instead.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // Below this the dashboard's tiles and charts stop being usable; the app's
    // responsive layout still adapts down to it.
    minWidth: 820,
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
  window.on("page-title-updated", (event) => event.preventDefault());

  window.once("ready-to-show", () => window.show());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(APP_ENTRY_URL);
  }
}

void app.whenReady().then(() => {
  handleAppProtocol(rendererRoot);
  createWindow();
});

// macOS keeps an app running with no windows open until the user quits it; every
// other platform treats the last window closing as quitting the app.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
