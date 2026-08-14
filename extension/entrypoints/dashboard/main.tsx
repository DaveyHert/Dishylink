import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App";

document.documentElement.dataset.host = "extension";
import { setApiHost } from "@/lib/apiHost";
import { setCloudHost } from "@/lib/cloudHost";
import { bindNotifications, setNotificationHost } from "@/lib/notifications";
import { setDishHost } from "@core/dishClient";
import { setSatelliteHost } from "@/lib/satellites";
import { extensionApiTransport } from "../../lib/apiTransport";
import { extensionCloudSignIn, extensionCloudTransport } from "../../lib/cloudTransport";
import { extensionNotificationHost } from "../../lib/notificationHost";
import { startClientSampler } from "../../lib/clientSampler";
import { DISH_HANDLE_URL, ROUTER_HANDLE_URL } from "../../lib/endpoints";

// The extension is the same dashboard as the web and desktop builds, bound to its
// own native transports before it renders. Recorded history has no origin to
// fetch, so it crosses to the service worker; the live LAN boxes and celestrak.org
// are reached directly, host permissions standing in for the same-origin proxies
// the other hosts use.
setApiHost({ transport: extensionApiTransport });

// Account features read starlink.com over the internet, carried to the service
// worker which holds the browser's own session; the app never learns the host.
setCloudHost({
  transport: extensionCloudTransport,
  signIn: extensionCloudSignIn,
  // Chrome extensions cannot reliably resolve the viewer's LAN IP or MAC on
  // desktop platforms. Disable the control so the extension can never offer to
  // pause the device it is running on.
  supportsRouterClientPause: false,
});

// The background worker posts OS notifications for alerts the user is not looking
// at — its alarm fires with no dashboard open. So the extension declares itself an
// announcing host, exactly as the desktop does: a backgrounded page leaves the
// toast to the worker while a page in front sounds its own chime, and the "Enable
// notifications" toggle reads and writes the worker's own preference through this
// bridge.
setNotificationHost(extensionNotificationHost);

// The dish and router live paths, direct to the LAN boxes. The router uses only
// get_status (5s) and wifi_get_clients (5s) — the same safe polls the desktop app
// and the historian already run; get_ping (1009), the RPC that reboots the router,
// is never called anywhere in the app.
setDishHost({ dishHandleUrl: DISH_HANDLE_URL, routerHandleUrl: ROUTER_HANDLE_URL });

// CelesTrak's ephemerides, fetched cross-origin under the celestrak.org host
// permission rather than the /celestrak proxy the web build uses.
setSatelliteHost("https://celestrak.org");

// With no always-on historian, the open dashboard measures its own per-device 1 Hz
// throughput into the sample store the app reads from /api/clients. Started here,
// at the seam, so the shared app never learns it is what fills the series.
const stopClientSampler = startClientSampler();
window.addEventListener("pagehide", stopClientSampler);

// Read the worker's stored on/off state before the first render, so the alerts
// panel's toggle shows what is actually set rather than flashing off. Awaited here
// where the desktop does not bother: chrome.storage is an async read with nothing
// pushing the answer in afterwards, so this is the only chance to have it before
// the first paint. The read is quick and always settles (it swallows its own
// failure), so waiting on it is safe.
bindNotifications().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
