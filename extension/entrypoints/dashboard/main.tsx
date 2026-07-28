import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { setApiHost } from "@/lib/apiHost";
import { setDishHost } from "@core/dishClient";
import { extensionApiTransport } from "../../lib/apiTransport";
import { DISH_HANDLE_URL } from "../../lib/endpoints";

// The extension is the same dashboard as the web and desktop builds, bound to its
// own native transports before it renders. Recorded history has no origin to
// fetch, so it crosses to the service worker; the live dish is reached directly,
// its host permissions standing in for the same-origin proxy the other hosts use.
setApiHost({ transport: extensionApiTransport });

// Dish only. The router keeps its proxy-path default, which resolves to this
// extension's own origin and 404s — so the router box is never polled from here.
// Enabling live router polling is a deliberate, separate step (it adds a second
// concurrent poller against a box that has rebooted under load).
setDishHost({ dishHandleUrl: DISH_HANDLE_URL });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
