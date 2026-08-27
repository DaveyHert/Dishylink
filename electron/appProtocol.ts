// The app:// protocol is how the packaged renderer reaches the network without an
// open port. The window loads app://bundle/, so its relative fetches (/dishy,
// /router, /celestrak, and later /api, /cloud) arrive here in the trusted main
// process — where there is no CORS to satisfy and the dish's Referer guard can be
// sidestepped by simply not sending one. Everything else is served as a static
// file from the built renderer. Only this app can originate app:// requests, so
// nothing else on the machine can reach the dish or the cloud session through it.

import { protocol, net } from "electron";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join, extname, normalize, sep } from "node:path";
import { createRouterOrigins } from "../core/routerEndpoint";
import { DISH_LAN_ADDRESS } from "../core/dishClient";
import { preferences } from "./preferences";

const DISH_PORT = 9201;

const SCHEME = "app";
const HOST = "bundle";

// The dish and the Starlink router speak grpc-web on their LAN IPs; CelesTrak
// publishes the Starlink ephemerides but sends no CORS headers, so it too must be
// fetched from here rather than the renderer.
const CELESTRAK_ORIGIN = "https://celestrak.org";

const DISH_ORIGIN = process.env.DISH_ORIGIN ?? `http://${DISH_LAN_ADDRESS}:${DISH_PORT}`;

/** Pins the router to one origin and turns the fallback off — for pointing a
 *  build at a stand-in. Unset, the router is found by core/routerEndpoint. */
const ROUTER_ORIGIN_OVERRIDE = process.env.ROUTER_ORIGIN ?? null;

/** This host's own IPv6 addresses, which is where the router's are derived from.
 *  Read per call rather than once: a laptop that joins a different network gets
 *  a different prefix, and a value cached at startup would outlive its network. */
const routerOrigins = createRouterOrigins(
  () =>
    Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv6" && !entry.internal)
      .map((entry) => entry!.address),
  () => preferences().routerAddress,
);

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
async function forwardable(request: Request): Promise<RequestInit> {
  const headers = new Headers(request.headers);
  headers.delete("referer");
  headers.delete("origin");
  headers.delete("host");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return {
    method: request.method,
    headers,
    // Captured as bytes, not left as the request's stream, so it can be sent
    // more than once — a body may only be read once, and the router below may
    // have to send the same call to a second address.
    body: hasBody ? await request.arrayBuffer() : undefined,
  };
}

async function proxy(request: Request, targetUrl: string): Promise<Response> {
  return net.fetch(targetUrl, await forwardable(request));
}

/**
 * Forward to the router, which unlike the dish has an address another router can
 * take: try IPv4, then the IPv6 addresses derived from this host's own prefixes.
 *
 * Only a rejected fetch — nobody home — moves on to the next origin. An HTTP
 * error is the router answering, and is returned as-is.
 */
async function proxyRouter(request: Request, path: string): Promise<Response> {
  const init = await forwardable(request);
  if (ROUTER_ORIGIN_OVERRIDE) return net.fetch(ROUTER_ORIGIN_OVERRIDE + path, init);
  return routerOrigins.run((origin) => net.fetch(origin + path, init));
}

/**
 * Serve a file from the built renderer. Unknown paths fall back to index.html so a
 * client-side route resolves to the app rather than a 404. `normalize` plus the
 * root-prefix check keeps a crafted `..` path from escaping the bundle.
 */
async function serveStatic(rendererRoot: string, pathname: string): Promise<Response> {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(rendererRoot, requested));
  const withinBundle = resolved === rendererRoot || resolved.startsWith(rendererRoot + sep);
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
  cloudHandler: (request: Request) => Promise<Response>,
): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const { pathname, search } = url;

    if (pathname.startsWith("/dishy/")) {
      return proxy(request, DISH_ORIGIN + pathname.slice("/dishy".length) + search);
    }
    if (pathname.startsWith("/router/")) {
      return proxyRouter(request, pathname.slice("/router".length) + search);
    }
    if (pathname.startsWith("/celestrak/")) {
      return proxy(request, CELESTRAK_ORIGIN + pathname.slice("/celestrak".length) + search);
    }
    // The collector and the cloud client both run in this process and answer here.
    if (pathname.startsWith("/api/")) {
      return apiHandler(request);
    }
    if (pathname.startsWith("/cloud/")) {
      return cloudHandler(request);
    }

    return serveStatic(rendererRoot, pathname);
  });
}
