import "./devMeasureGuard.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { RecoveringErrorBoundary } from "./components/shared/RecoveringErrorBoundary.tsx";
import { setCloudHost } from "./lib/cloudHost.ts";
import { bindNotifications } from "./lib/notifications.ts";
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
  // Only a build serving its own /api has the recorder in this process, where it
  // cannot be down while this window is asking — see recorderRunsInHostProcess.
  void desktop.recorderInProcess().then(setRecorderInProcess);
}

// Bound for every host, desktop or plain tab, since each keeps the notification
// state somewhere different. Not awaited: the desktop's answer crosses the bridge,
// and main pushes it again as this page finishes loading, so the alerts panel is
// either right on its first paint or corrected in the same beat. A tab needs no
// round trip at all — it reads its own storage here, before render.
void bindNotifications();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RecoveringErrorBoundary>
      <App />
    </RecoveringErrorBoundary>
  </StrictMode>,
);
