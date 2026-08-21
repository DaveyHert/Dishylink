import path from "node:path";
import { readFileSync } from "node:fs";
// vitest's defineConfig, so the `test` block below is typed. It is a superset of
// vite's — the dev/build config is unaffected.
import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import { starlinkCloudProxy } from "./dev/starlinkCloudProxy";
import { routerProxy } from "./dev/routerProxy";

// Config files run in plain Node, outside every build target's tsconfig
// `include`, so this is the one place package.json can be read without wiring
// resolveJsonModule into src/electron/extension for one string.
const appVersion: string = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
).version;

interface OutgoingProxyRequest {
  removeHeader(headerName: string): void;
}

// The Electron host is opt-in per command (ELECTRON=1) so plain `vite` stays a
// browser dev server — running the extension/browser build never launches a window.
const withElectron = process.env.ELECTRON === "1";

// The dish's grpc-web endpoint (port 9201) only allows CORS from its own
// origin, so the dev server proxies it same-origin under /dishy.
export default defineConfig(({ command }) => ({
  // A packaged Electron app loads the renderer from disk via loadFile, so its
  // assets must be referenced relatively. The browser build and every dev server
  // keep an absolute base.
  base: withElectron && command === "build" ? "./" : "/",
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    tailwindcss(),
    starlinkCloudProxy(),
    routerProxy(),
    ...(withElectron
      ? [
          electron({
            main: { entry: "electron/main.ts" },
            preload: { input: "electron/preload.ts" },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "./core"),
    },
  },
  // satellite.js' wasm/pthreads build spawns Web Workers; Vite bundles workers
  // as iife by default, which can't do the top-level await that build uses.
  // Emit workers as ES modules so the production build succeeds.
  worker: { format: "es" },
  test: {
    projects: [
      // Pure logic — decoders, stores, catalogues. No DOM, no browser, fast.
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "core/**/*.test.ts",
            "cloud/**/*.test.ts",
            "collector/**/*.test.mts",
            "dev/**/*.test.mts",
            "electron/**/*.test.ts",
            "extension/**/*.test.ts",
          ],
          // Extension store tests that need real IndexedDB run in the browser
          // project below, not this Node one.
          exclude: [...configDefaults.exclude, "extension/**/*.browser.test.ts"],
          // Own group: this project's maxWorkers differs from the browser
          // project's, and Vitest requires distinct groupOrder whenever that's
          // the case.
          sequence: { groupOrder: 0 },
        },
      },
      // Component tests in real Chromium, not jsdom: they render canvas and WebGL
      // (the sky view's camera and scene), diff screenshot baselines, and measure
      // real layout — none of which jsdom can do.
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx", "extension/**/*.browser.test.ts"],
          setupFiles: ["./src/test-setup.ts"],
          // Each worker holds its own real Chromium context; too many
          // rendering canvas/WebGL at once starve each other and fail at
          // random. Capped below the default worker count for a
          // deterministic run, at the cost of wall-clock time.
          maxWorkers: 3,
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
  server: {
    proxy: {
      "/dishy": {
        target: "http://192.168.100.1:9201",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dishy/, ""),
        // The dish returns an empty 200 when the request carries a browser
        // Referer/Origin it doesn't recognize — strip them before forwarding.
        // Vite 7's bundled proxy typings omit the EventEmitter surface that
        // exists at runtime, hence the cast.
        configure: (proxy) => {
          const proxyEvents = proxy as unknown as {
            on(eventName: "proxyReq", handler: (proxyRequest: OutgoingProxyRequest) => void): void;
          };
          proxyEvents.on("proxyReq", (proxyRequest) => {
            proxyRequest.removeHeader("referer");
            proxyRequest.removeHeader("origin");
          });
        },
      },
      // /router is not here: its address can be taken by another router, so it
      // is served by dev/routerProxy, which can retry against a second one.
      // CelesTrak publishes SpaceX's official Starlink ephemerides but sends
      // no CORS headers; same-origin proxy for the TLE fetch.
      "/celestrak": {
        target: "https://celestrak.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak/, ""),
      },
      // Cloudflare speed endpoints for the browser-measured speed test
      // (the dish's own speedtest RPCs are unimplemented on current firmware).
      "/speedtest": {
        target: "https://speed.cloudflare.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/speedtest/, ""),
      },
    },
  },
}));
