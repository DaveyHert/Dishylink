import "./devMeasureGuard.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { RecoveringErrorBoundary } from "./components/shared/RecoveringErrorBoundary.tsx";
import { setCloudHost } from "./lib/cloudHost.ts";
import { bindNotifications } from "./lib/notifications.ts";
import { setRecorderInProcess } from "./lib/apiHost.ts";
import { setRouterAddressHost } from "./lib/routerAddressHost.ts";

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
  // Main owns where the router is dialled, because the recorder there dials it
  // with no window open. Only in a build that serves itself, though: a dev-server
  // page's /router/* calls are carried by Vite, not by main, so main's copy of the
  // address would be a setting that changes nothing.
  if (!import.meta.env.DEV && desktop.routerAddress && desktop.setRouterAddress) {
    const read = desktop.routerAddress;
    const write = desktop.setRouterAddress;
    setRouterAddressHost({
      read: () => read(),
      // Main reaches any LAN address it is given, so the only way a write fails
      // here is an address it could not parse.
      write: async (address) => {
        const addresses = await write(address);
        return addresses ? { ok: true, addresses } : { ok: false, reason: "invalid" };
      },
    });
  }
}

// The dev server proxies /router/* itself and honours the address stored beside
// it, so the setting works there exactly as it does in the packaged app. A built
// page served from anywhere else reaches no LAN address whatever it is told, and
// binds nothing.
//
// This holds under the desktop shell too. A dev run loads the window from the dev
// server, so its router calls leave through Vite whatever process is hosting it,
// and the store the setting writes has to be the one that request consults.
if (import.meta.env.DEV) {
  const readAddresses = async () => {
    const response = await fetch("/router-address");
    return (await response.json()) as { router: string | null; routerDefault: string };
  };
  setRouterAddressHost({
    read: readAddresses,
    write: async (address) => {
      const response = await fetch("/router-address", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!response.ok) return { ok: false, reason: "invalid" };
      return { ok: true, addresses: await response.json() };
    },
  });
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
