import { defineConfig } from "wxt";

// The browser-extension host. Its entrypoints live under extension/ so WXT's own
// Vite build stays clear of the web/electron build in vite.config.ts; both share
// core/ and cloud/ through the @core/@cloud aliases below.
//
// The extension collects only while the browser runs — chrome.alarms plus the
// dish's ~15-minute ring buffer — and shows honest coverage gaps for any closed
// stretch. Always-on collection is the Electron app's job, a separate product.
export default defineConfig({
  srcDir: "extension",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    // satellite.js is a wasm build; its worker needs es-module output for top-level await.
    worker: { format: "es" },
    // Scope dependency pre-bundling to the extension's own pages. Left to its
    // default, Vite globs every index.html at the repo root — including the web
    // app's and a stale dist/ build — and the scan errors on their web-only imports.
    optimizeDeps: { entries: ["extension/entrypoints/**/*.html"] },
  }),
  manifest: {
    name: "DishyLink",
    description: "Live dashboard and history recorder for a Starlink kit (unofficial).",
    // A background service worker fetching 192.168.100.1 hit a Chromium Local
    // Network Access bug fixed only in 144; below it the drain silently collects
    // nothing, which is an unreproducible bug report. Excludes Chrome 142–143.
    minimum_chrome_version: "144",
    permissions: ["alarms", "storage", "cookies"],
    // Host permissions are what exempt the extension from the Local Network Access
    // prompt a plain web page now faces — the exemption is what makes it viable.
    // Match patterns ignore port, so these cover the dish's :9201 and router's :9000.
    host_permissions: [
      "http://192.168.100.1/*",
      "http://192.168.1.1/*",
      "https://*.starlink.com/*",
      "https://celestrak.org/*",
    ],
    // 'wasm-unsafe-eval' for satellite.js. No declarativeNetRequest: an extension
    // never sends the Referer the dish's guard rejects, so no ruleset is needed.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // No default_popup, so chrome.action.onClicked fires and the background opens
    // the full manager page — a chart-heavy dashboard wants room, not a dropdown.
    // default_icon is set explicitly rather than left to the icons fallback.
    action: {
      default_title: "DishyLink",
      default_icon: { "16": "icon/16.png", "32": "icon/32.png", "48": "icon/48.png", "128": "icon/128.png" },
    },
  },
  alias: {
    "@core": "core",
    "@cloud": "cloud",
  },
});
