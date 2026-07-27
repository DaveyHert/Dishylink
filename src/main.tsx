import "./devMeasureGuard.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// The Electron preload exposes window.dishlink; marking the root lets the desktop
// build reserve space for the macOS traffic lights and make its top bar draggable,
// without affecting the browser or extension.
if ("dishlink" in window) document.documentElement.dataset.host = "electron";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
