// The preload is the single, deliberately narrow bridge between the sandboxed
// renderer and the privileged main process. It exposes a small typed surface on
// window.dishlink; every capability the UI needs from the host (collector data,
// dish/router/cloud transport, sign-in) is added here as an explicit method, never
// by handing the renderer raw Node, IPC, or Electron objects.

import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("dishlink", {
  // Present only to prove the bridge is live from the renderer; the real methods
  // replace it as each transport binding lands.
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
