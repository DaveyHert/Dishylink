// The Electron main process — the app's one privileged host. It owns the window
// today, and (as later steps land) the collector, the dish/router/cloud transport,
// and the Starlink sign-in. The renderer is sandboxed and reaches this side only
// through the typed bridge in preload.ts: there is no localhost port, so nothing on
// the machine but this app can reach the user's dish data or cloud session.

import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// vite-plugin-electron sets this while `vite` is serving; it is absent in a
// packaged build, where the renderer is loaded from disk instead.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
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

  window.once("ready-to-show", () => window.show());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(here, "../dist/index.html"));
  }
}

void app.whenReady().then(createWindow);

// macOS keeps an app running with no windows open until the user quits it; every
// other platform treats the last window closing as quitting the app.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
