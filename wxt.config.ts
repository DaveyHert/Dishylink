import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See vite.config.ts's own copy of this read for why it's done per-config
// rather than imported as a module.
const appVersion: string = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
).version;

// srcDir is the shared app tree so WXT's built-in `@`/`~` aliases point at ./src,
// exactly as the web build's do — the extension mounts the same src/App and its
// files import `@/…`. The entrypoints live outside it, under ./extension, kept
// clear of the web/electron build in vite.config.ts; entrypointsDir points back
// there. publicDir stays WXT's default ./public (root-relative regardless of
// srcDir), so dish.protoset and oui.json still ship. core/ and cloud/ resolve
// through the @core/@cloud aliases below.
const entrypointsDir = fileURLToPath(new URL("./extension/entrypoints", import.meta.url));

// The extension collects only while the browser runs — chrome.alarms plus the
// dish's ~15-minute ring buffer — and shows honest coverage gaps for any closed
// stretch. Always-on collection is the Electron app's job, a separate product.
export default defineConfig({
  srcDir: "src",
  entrypointsDir,
  modules: ["@wxt-dev/module-react"],
  // The extension's own auto-imports scan srcDir; the shared app tree imports
  // everything explicitly, so leave WXT's magic auto-imports off to avoid pulling
  // hundreds of app symbols into scope (#imports still works for defineBackground).
  imports: false,
  vite: () => ({
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    // Tailwind processes index.css's utility classes; without it the extension
    // ships the shared app's markup with none of its styling — the same plugin the
    // web build runs in vite.config.ts. (@wxt-dev/module-react adds React itself.)
    plugins: [tailwindcss()],
    // satellite.js is a wasm build; its worker needs es-module output for top-level await.
    worker: { format: "es" },
    // Scope dependency pre-bundling to the extension's own pages. Left to its
    // default, Vite globs every index.html at the repo root — including the web
    // app's and a stale dist/ build — and the scan errors on their web-only imports.
    optimizeDeps: { entries: ["extension/entrypoints/**/*.html"] },
  }),
  manifest: {
    name: "Dishylink",
    description:
      "Monitor your Starlink's performance and health. Live telemetry, speed test, obstruction map, alignment, alerts, per-device usage.",
    // A background service worker fetching 192.168.100.1 hit a Chromium Local
    // Network Access bug fixed only in 144; below it the drain silently collects
    // nothing, which is an unreproducible bug report. Excludes Chrome 142–143.
    minimum_chrome_version: "144",
    // declarativeNetRequestWithHostAccess lets the worker attach the browser's own
    // starlink.com cookies to its cloud fetches: a cross-site service-worker fetch
    // has them withheld by SameSite even with credentials, so the Cookie header is
    // set at the network layer instead — scoped to the worker's own requests.
    // "notifications" is what lets the drain tick tell the user the dish went
    // offline while no dashboard is open — the extension's only alerting path.
    permissions: [
      "alarms",
      "storage",
      "cookies",
      "notifications",
      "declarativeNetRequestWithHostAccess",
      // Satellite tracking reads the observer's coordinates from the browser (the
      // "use this device location" option). Declaring it keeps that call from
      // logging Chrome's "is this permission appropriate?" advisory and spares the
      // user a per-use prompt.
      "geolocation",
    ],
    // Host permissions are what exempt the extension from the Local Network Access
    // prompt a plain web page now faces — the exemption is what makes it viable.
    // Match patterns ignore port, so these cover the dish's :9201 and router's :9000.
    host_permissions: [
      "http://192.168.100.1/*",
      "http://192.168.1.1/*",
      "https://*.starlink.com/*",
      "https://celestrak.org/*",
    ],
    // A kit moved off its default subnet, or in bypass mode, sits at an address no
    // static manifest can name, and MV3 host permissions are fixed at build time —
    // so an arbitrary address is reachable only as an optional permission. This is
    // the ceiling on what may be asked for, not a grant: the request names the one
    // address being saved (lib/endpoints.ts). It cannot be narrowed to the private
    // ranges — a match pattern's host is "*", or "*." plus a literal suffix, or a
    // literal host, with no CIDR and no wildcard inside a host. http only: the
    // boxes speak plain grpc-web on the LAN.
    optional_host_permissions: ["http://*/*"],
    // 'wasm-unsafe-eval' for satellite.js. No declarativeNetRequest: an extension
    // never sends the Referer the dish's guard rejects, so no ruleset is needed.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // No default_popup, so chrome.action.onClicked fires and the background opens
    // the full dashboard page — a chart-heavy dashboard wants room, not a dropdown.
    // default_icon is set explicitly rather than left to the icons fallback.
    action: {
      default_title: "Dishylink",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
    // Matches PRIVACY.md: no backend, no analytics — nothing the extension does
    // is collected by us. Required by AMO for new submissions since 2025-11-03.
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: { required: ["none"] },
      },
    },
  },
  zip: {
    excludeSources: [
      "release/**",
      "dist/**",
      "dist-electron/**",
      ".output/**",
      "landing/**",
      "collector/data/**",
    ],
  },
  alias: {
    "@core": "core",
    "@cloud": "cloud",
  },
});
