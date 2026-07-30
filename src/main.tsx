import "./devMeasureGuard.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { setCloudHost } from "./lib/cloudHost.ts";
import { loadNotificationPreference } from "./lib/notifications.ts";
import { setRecorderInProcess } from "./lib/apiHost.ts";

// The Electron preload exposes window.dishlink. Marking the root lets the desktop
// build reserve space for the macOS traffic lights and make its top bar draggable,
// without affecting the browser or extension.
const desktop = window.dishlink;
if (desktop) {
  document.documentElement.dataset.host = "electron";
  // The desktop app's session lives in the main process, so its cloud calls and
  // its sign-in both go over the preload bridge — not to whatever origin served
  // this page. The extension binds its own pair here in the same way.
  setCloudHost({
    // An AbortSignal cannot cross the bridge; main answers a single request and
    // the caller drops a reply it no longer wants.
    transport: ({ path, method, body }) => desktop.cloud({ path, method, body }),
    signIn: desktop.signIn,
  });
  // Whether alerts are announced is the main process's to know — it announces
  // them from the tray with no window open. Mirrored in before render so the
  // alerts panel's toggle shows the real state rather than defaulting to off.
  void loadNotificationPreference();
  // The recorder runs in the same process that serves /api here, so it cannot be
  // down while this window is asking — see recorderRunsInHostProcess.
  setRecorderInProcess(true);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
