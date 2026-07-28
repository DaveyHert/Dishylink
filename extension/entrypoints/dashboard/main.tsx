import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { setApiHost } from "@/lib/apiHost";
import { setDishHost } from "@core/dishClient";
import { setSatelliteHost } from "@/lib/satellites";
import { extensionApiTransport } from "../../lib/apiTransport";
import { DISH_HANDLE_URL, ROUTER_HANDLE_URL } from "../../lib/endpoints";

// The extension is the same dashboard as the web and desktop builds, bound to its
// own native transports before it renders. Recorded history has no origin to
// fetch, so it crosses to the service worker; the live LAN boxes and celestrak.org
// are reached directly, host permissions standing in for the same-origin proxies
// the other hosts use.
setApiHost({ transport: extensionApiTransport });

// The dish and router live paths, direct to the LAN boxes. The router uses only
// get_status (5s) and wifi_get_clients (5s) — the same safe polls the desktop app
// and the historian already run; get_ping (1009), the RPC that reboots the router,
// is never called anywhere in the app.
setDishHost({ dishHandleUrl: DISH_HANDLE_URL, routerHandleUrl: ROUTER_HANDLE_URL });

// CelesTrak's ephemerides, fetched cross-origin under the celestrak.org host
// permission rather than the /celestrak proxy the web build uses.
setSatelliteHost("https://celestrak.org");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
