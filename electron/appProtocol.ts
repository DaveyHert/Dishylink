// The app:// protocol is how the packaged renderer reaches the network without an
// open port. The window loads app://bundle/, so its relative fetches (/dishy,
// /router, /celestrak, and later /api, /cloud) arrive here in the trusted main
// process — where there is no CORS to satisfy and the dish's Referer guard can be
// sidestepped by simply not sending one. Everything else is served as a static
// file from the built renderer. Only this app can originate app:// requests, so
// nothing else on the machine can reach the dish or the cloud session through it.

import { protocol, net } from "electron";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const SCHEME = "app";
const HOST = "bundle";

// The dish and the Starlink router speak grpc-web on their LAN IPs; CelesTrak
// publishes the Starlink ephemerides but sends no CORS headers, so it too must be
// fetched from here rather than the renderer.
const DISH_ORIGIN = process.env.DISH_ORIGIN ?? "http://192.168.100.1:9201";
const ROUTER_ORIGIN = process.env.ROUTER_ORIGIN ?? "http://192.168.1.1:9001";
const CELESTRAK_ORIGIN = "https://celestrak.org";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/**
 * Declare app:// before the app is ready — it must be a standard, secure origin so
 * the renderer treats it like https: fetch works, workers load, and storage
 * persists. Called once, synchronously, at startup.
 */
export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** The URL the window loads to run the built renderer over this protocol. */
export const APP_ENTRY_URL = `${SCHEME}://${HOST}/index.html`;

/**
 * Forward a renderer request to a LAN or web origin from the main process. The
 * dish returns an empty 200 to any request carrying a Referer/Origin it does not
 * recognize, so those are dropped rather than forwarded; the host header is left to
 * net.fetch to set for the real target.
 */
async function proxy(request: Request, targetUrl: string): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("referer");
  headers.delete("origin");
  headers.delete("host");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return net.fetch(targetUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });
}

/**
 * Serve a file from the built renderer. Unknown paths fall back to index.html so a
 * client-side route resolves to the app rather than a 404. `normalize` plus the
 * root-prefix check keeps a crafted `..` path from escaping the bundle.
 */
async function serveStatic(rendererRoot: string, pathname: string): Promise<Response> {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(rendererRoot, requested));
  const withinBundle = resolved === rendererRoot || resolved.startsWith(rendererRoot + "/");
  const filePath = withinBundle ? resolved : join(rendererRoot, "index.html");
  try {
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    return new Response(body, { headers: { "content-type": type } });
  } catch {
    // A missing asset is a real 404; a missing route falls through to the app.
    if (extname(filePath)) return new Response("Not found", { status: 404 });
    return serveStatic(rendererRoot, "/index.html");
  }
}

/**
 * Route every app:// request: the transport prefixes go out to the network from
 * here, everything else is a file from the built renderer at `rendererRoot`.
 * Registered once, after the app is ready.
 */
export function handleAppProtocol(
  rendererRoot: string,
  apiHandler: (request: Request) => Promise<Response>,
): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const { pathname, search } = url;

    if (pathname.startsWith("/dishy/")) {
      return proxy(request, DISH_ORIGIN + pathname.slice("/dishy".length) + search);
    }
    if (pathname.startsWith("/router/")) {
      return proxy(request, ROUTER_ORIGIN + pathname.slice("/router".length) + search);
    }
    if (pathname.startsWith("/celestrak/")) {
      return proxy(request, CELESTRAK_ORIGIN + pathname.slice("/celestrak".length) + search);
    }
    // The collector runs in this process; its /api handler is served in-process.
    if (pathname.startsWith("/api/")) {
      return apiHandler(request);
    }
    // /cloud (the signed-in account) is added when the cloud sign-in lands.

    return serveStatic(rendererRoot, pathname);
  });
}
