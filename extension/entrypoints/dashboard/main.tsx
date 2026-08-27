import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App";

document.documentElement.dataset.host = "extension";
import { setApiHost } from "@/lib/apiHost";
import { setCloudHost } from "@/lib/cloudHost";
import { setSelfDeviceHost } from "@/lib/selfDeviceHost";
import { bindNotifications, setNotificationHost } from "@/lib/notifications";
import { setBadgeModeHost } from "@/lib/badgeMode";
import { extensionBadgeModeHost } from "../../lib/badgeModeHost";
import { setDishHost } from "@core/dishClient";
import { setSatelliteHost } from "@/lib/satellites";
import { extensionApiTransport } from "../../lib/apiTransport";
import { extensionCloudSignIn, extensionCloudTransport } from "../../lib/cloudTransport";
import { extensionNotificationHost } from "../../lib/notificationHost";
import { startClientSampler } from "../../lib/clientSampler";
import { loadSelfDeviceClientId, storeSelfDeviceClientId } from "../../lib/selfDevice";
import {
  dishHandleUrl,
  loadRouterAddress,
  routerHandleUrl,
  storeRouterAddress,
  watchRouterAddress,
  ROUTER_LAN_ADDRESS,
} from "../../lib/endpoints";
import { setRouterAddressHost } from "@/lib/routerAddressHost";

// The extension is the same dashboard as the web and desktop builds, bound to its
// own native transports before it renders. Recorded history has no origin to
// fetch, so it crosses to the service worker; the live LAN boxes and celestrak.org
// are reached directly, host permissions standing in for the same-origin proxies
// the other hosts use.
setApiHost({ transport: extensionApiTransport });

// Account features read starlink.com over the internet, carried to the service
// worker which holds the browser's own session; the app never learns the host.
setCloudHost({ transport: extensionCloudTransport, signIn: extensionCloudSignIn });

// Chrome extensions cannot resolve the viewer's LAN IP or MAC, so the device this
// runs on is whichever roster entry the user named.
setSelfDeviceHost({ read: loadSelfDeviceClientId, write: storeSelfDeviceClientId });

// The background worker posts OS notifications for alerts the user is not looking
// at — its alarm fires with no dashboard open. So the extension declares itself an
// announcing host, exactly as the desktop does: a backgrounded page leaves the
// toast to the worker while a page in front sounds its own chime, and the "Enable
// notifications" toggle reads and writes the worker's own preference through this
// bridge.
setNotificationHost(extensionNotificationHost);

setBadgeModeHost(extensionBadgeModeHost);

// Where the router is, when 192.168.1.1 is wrong for this kit. Unlike the desktop
// app, which resolves an origin per request in its main process, the extension
// binds this once before render — so a change reloads the page rather than
// leaving already-loaded clients pointed at the old address.
watchRouterAddress();
setRouterAddressHost({
  read: async () => ({ ...(await loadRouterAddress()), routerDefault: ROUTER_LAN_ADDRESS }),
  write: async (address) => {
    const stored = await storeRouterAddress(address);
    if (!stored.ok) return stored;
    // Clients already loaded in this page hold the URL they were built with, so
    // the page is reloaded rather than left half-pointed at the old router.
    // Queued behind this result so the row settles before the document goes away.
    setTimeout(() => location.reload(), 0);
    return { ok: true, addresses: { ...stored.addresses, routerDefault: ROUTER_LAN_ADDRESS } };
  },
});

// CelesTrak's ephemerides, fetched cross-origin under the celestrak.org host
// permission rather than the /celestrak proxy the web build uses.
setSatelliteHost("https://celestrak.org");

// With no always-on historian, the open dashboard measures its own per-device 1 Hz
// throughput into the sample store the app reads from /api/clients. Started at the
// seam below, once the router's address is known, so the shared app never learns
// it is what fills the series.
function startSampler(): void {
  const stopClientSampler = startClientSampler();
  window.addEventListener("pagehide", stopClientSampler);
}

// Read the worker's stored on/off state before the first render, so the alerts
// panel's toggle shows what is actually set rather than flashing off. Awaited here
// where the desktop does not bother: chrome.storage is an async read with nothing
// pushing the answer in afterwards, so this is the only chance to have it before
// the first paint. The read is quick and always settles (it swallows its own
// failure), so waiting on it is safe.
// The dish and router live paths, direct to the LAN boxes. The router uses only
// get_status (5s) and wifi_get_clients (5s) — the same safe polls the desktop app
// and the historian already run; get_ping (1009), the RPC that reboots the router,
// is never called anywhere in the app.
//
// Bound after the stored addresses are read, for the same reason notifications
// are: chrome.storage is an async read with nothing pushing the answer in
// afterwards, and a client loaded against the default would keep dialling it.
loadRouterAddress()
  .then(() => {
    setDishHost({ dishHandleUrl: dishHandleUrl(), routerHandleUrl: routerHandleUrl() });
    startSampler();
    return bindNotifications();
  })
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
