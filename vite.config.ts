import path from "node:path";
// vitest's defineConfig, so the `test` block below is typed. It is a superset of
// vite's — the dev/build config is unaffected.
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { starlinkCloudProxy } from "./dev/starlinkCloudProxy";

interface OutgoingProxyRequest {
  removeHeader(headerName: string): void;
}

// The dish's grpc-web endpoint (port 9201) only allows CORS from its own
// origin, so the dev server proxies it same-origin under /dishy.
export default defineConfig({
  plugins: [react(), tailwindcss(), starlinkCloudProxy()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
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
          include: ["src/**/*.test.ts", "server/**/*.test.mts", "dev/**/*.test.mts"],
        },
      },
      // Component tests in real Chromium. NOT jsdom: jsdom has no CSS engine, so
      // getComputedStyle returns nothing useful and it cannot verify design fidelity
      // at all — which is the entire reason these tests exist.
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
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
      // The Starlink router speaks the same grpc-web protocol on its LAN IP.
      "/router": {
        target: "http://192.168.1.1:9001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/router/, ""),
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
      // CelesTrak publishes SpaceX's official Starlink ephemerides but sends
      // no CORS headers; same-origin proxy for the TLE fetch.
      "/celestrak": {
        target: "https://celestrak.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak/, ""),
      },
      // Long-term energy totals from the local collector service (server/).
      // xfwd adds x-forwarded-for so /api/whoami sees the browser's LAN IP, not
      // this proxy's loopback address.
      "/api": {
        target: "http://localhost:8088",
        changeOrigin: true,
        xfwd: true,
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
});
