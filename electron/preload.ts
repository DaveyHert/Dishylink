// The preload is the single, deliberately narrow bridge between the sandboxed
// renderer and the privileged main process. It exposes a small typed surface on
// window.dishlink; every capability the UI needs from the host (collector data,
// dish/router/cloud transport, sign-in) is added here as an explicit method, never
// by handing the renderer raw Node, IPC, or Electron objects.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dishlink", {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Opens the Starlink login window in the main process; resolves once the account
  // is connected, or with ok:false if the user closes it.
  signIn: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("starlink-signin"),
  // Answers the renderer's /cloud/* calls from the main process, which is where
  // the account session lives. The window's own origin only serves those routes
  // when it is loaded over app://; on the dev server it is Vite's origin, whose
  // middleware keeps a different session store. Going through main makes the
  // desktop app use one session either way.
  cloud: (request: {
    path: string;
    method?: string;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }> => ipcRenderer.invoke("cloud-request", request),
  // Posts a desktop notification from the main process, resolving to whether the
  // OS actually delivered it and, when it didn't, why — the packaged-vs-unsigned
  // reason only main can tell.
  //
  // The renderer's own Notification API is not usable in the packaged app: it
  // loads over app://, and asking a sandboxed custom-origin renderer for
  // notification permission leaves `Notification.permission` somewhere other than
  // "granted" — so the app's own "enabled" check could never become true and the
  // toggle could never turn on. Main has no such gate; it talks to the OS
  // directly, and macOS prompts once for the app itself rather than for a web
  // origin. Every run routes through main, so dev behaves as the packaged app does.
  notify: (title: string, body: string): Promise<{ delivered: boolean; reason?: string }> =>
    ipcRenderer.invoke("notify", { title, body }),
});
