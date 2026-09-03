// Browser host for the Docker image: the built SPA plus every same-origin
// proxy the Vite dev server used to provide. The historian runs in-process
// (HISTORIAN_EMBED) so /api is handled here rather than over a second port.
//
// Dish and router stay on the host's Starlink LAN — this process only forwards
// to them. Docker Desktop on a Mac has no real host network, so IPv4 NAT to
// 192.168.100.1 / 192.168.1.1 is the path; HOST_LAN_IP supplies the Mac's
// addresses when the container's own NICs are not on that LAN.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createReadStream,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { createRouterOrigins } from "../core/routerEndpoint.ts";
import { DISH_LAN_HANDLE_URL, ROUTER_LAN_ADDRESS } from "../core/dishClient.ts";
import { normalizeIpAddress } from "../core/ipAddress.ts";
import { identityFromEnv } from "../core/hostNetworkIdentity.ts";
import type { RouterClientUpdate } from "../core/routerClientUpdate.ts";
import { CollectorBusyError } from "../collector/collectorLock.mts";
import { isLocalOrigin } from "../collector/localOrigin.mts";
import {
  createFileCloudHandler,
  dispatchCloudRequest,
  cookieStore,
} from "../dev/starlinkCloudProxy.ts";
import { classifyBrowserPath } from "./browserRoutes.ts";

process.env.HISTORIAN_EMBED = "1";
process.env.HISTORIAN_DATA_DIR ??= existsSync("/data") ? "/data" : resolve("collector/data");
process.env.HISTORIAN_PROTOSET ??= resolve("public/dish.protoset");

const PORT = Number(process.env.BROWSER_HOST_PORT ?? 8080);
const DIST = resolve(process.env.BROWSER_DIST ?? "dist");
const DISH_ORIGIN = originOf(process.env.DISH_URL ?? DISH_LAN_HANDLE_URL);
const ROUTER_URL_OVERRIDE = process.env.ROUTER_URL ?? null;
const CELESTRAK_ORIGIN = "https://celestrak.org";
const SPEEDTEST_ORIGIN = "https://speed.cloudflare.com";

const SKIP_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function originOf(handleUrl: string): string {
  const url = new URL(handleUrl);
  return `${url.protocol}//${url.host}`;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function forwardableHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === "referer" || lower === "origin" || lower === "host") continue;
    if (lower === "connection" || lower === "content-length") continue;
    // No destination here takes a credential: the dish and router answer
    // unauthenticated on the LAN, celestrak.org and the speed test are public.
    if (lower === "cookie" || lower === "authorization") continue;
    headers.set(lower, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function proxyTo(
  targetUrl: string,
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer | undefined,
  timeoutMs: number,
): Promise<void> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: forwardableHeaders(request),
    body: hasBody ? (body as BodyInit) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  upstream.headers.forEach((value, name) => {
    if (!SKIP_RESPONSE_HEADERS.has(name)) response.setHeader(name, value);
  });
  response.statusCode = upstream.status;
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}

function safeFile(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = resolve(DIST, relative);
  const root = DIST.endsWith(sep) ? DIST : DIST + sep;
  if (resolved !== DIST && !resolved.startsWith(root)) return null;
  return resolved;
}

function serveFile(filePath: string, response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
  );
  createReadStream(filePath).pipe(response);
}

function serveStatic(urlPath: string, response: ServerResponse): void {
  const filePath = safeFile(urlPath);
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(filePath, response);
    return;
  }
  const index = join(DIST, "index.html");
  if (existsSync(index)) {
    serveFile(index, response);
    return;
  }
  sendText(response, 404, "not found");
}

const routerOrigins = createRouterOrigins(
  () => [
    ...(identityFromEnv()?.ipAddresses ?? []),
    ...Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv6" && !entry.internal)
      .map((entry) => entry!.address),
  ],
  () => readRouterAddress(),
);

const cookieFile = resolve(
  process.env.STARLINK_COOKIE_FILE ?? resolve(process.cwd(), ".starlink-cookie"),
);
const { readCookie } = cookieStore(cookieFile);

const DATA_DIR = process.env.HISTORIAN_DATA_DIR ?? resolve("collector/data");
const SELF_DEVICE_FILE = join(DATA_DIR, "self-device.json");

function readSelfDevice(): number | null {
  try {
    const { clientId } = JSON.parse(readFileSync(SELF_DEVICE_FILE, "utf8")) as {
      clientId?: unknown;
    };
    return typeof clientId === "number" &&
      Number.isInteger(clientId) &&
      clientId >= 0 &&
      clientId <= 0xffff_ffff
      ? clientId
      : null;
  } catch {
    return null;
  }
}

const ROUTER_ADDRESS_FILE = join(DATA_DIR, "router-address");

function readRouterAddress(): string | null {
  try {
    return normalizeIpAddress(readFileSync(ROUTER_ADDRESS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeSelfDevice(clientId: number | null): void {
  if (clientId === null) {
    try {
      rmSync(SELF_DEVICE_FILE);
    } catch {
      /* nothing named yet */
    }
    return;
  }
  writeFileSync(SELF_DEVICE_FILE, JSON.stringify({ clientId }), "utf8");
}

const cloudHandler = createFileCloudHandler({
  identity: () => ({
    ...(identityFromEnv() ?? { ipAddresses: [], macAddresses: [] }),
    ...(readSelfDevice() === null ? {} : { clientId: readSelfDevice()! }),
  }),
  protosetPath: process.env.HISTORIAN_PROTOSET,
  cookieFile,
});

// Pausing the device this dashboard runs on cuts off the connection needed to
// undo it. Enforced here as well as in the control that renders it.
const guardedCloudHandler = {
  ...cloudHandler,
  updateClient: async (update: RouterClientUpdate) => {
    if (update?.kind !== "pause") return cloudHandler.updateClient(update);
    const selfClientId = readSelfDevice();
    if (selfClientId === null)
      return {
        status: 409,
        body: {
          error: "self_device_unknown",
          message: "Choose this device under Settings → App before pausing others.",
        },
      };
    if (update.clientId === selfClientId)
      return {
        status: 409,
        body: {
          error: "self_pause_refused",
          message: "This is the device you are using, so it cannot be paused from here.",
        },
      };
    return cloudHandler.updateClient(update);
  },
};

// An embedded historian records nothing until start() is called.
let handleRequest: ((request: IncomingMessage, response: ServerResponse) => void) | null = null;
try {
  const historian = await import("../collector/historian.mts");
  historian.setRouterAddressReader(() => readRouterAddress());
  historian.setAccountSessionReader(() => readCookie() !== null);
  historian.setDevicePauser(async (clientId, paused) => {
    const { status, body } = await guardedCloudHandler.updateClient({
      kind: "pause",
      clientId,
      paused,
    });
    if (status === 200) return;
    const message = (body as { message?: string })?.message ?? `HTTP ${status}`;
    throw new Error(status === 428 ? "No Starlink account connected" : message);
  });
  // Last: the first poll can reach a rule that owes a pause.
  historian.start();
  handleRequest = historian.handleRequest;
} catch (error) {
  if (error instanceof CollectorBusyError) throw error;
  console.error(`[browser-host] recorder not started: ${(error as Error).message}`);
}

// Published on every interface, so Origin is the only check left on a write that
// reaches as far as deleting the usage history or repointing the router. Stricter
// than the recorder's own rule on purpose: an absent Origin passes there, as a
// non-browser client, and here it is a caller declining to be identified.
function writeRefused(request: IncomingMessage, response: ServerResponse): boolean {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const origin = request.headers.origin;
  if (origin && isLocalOrigin(origin)) return false;
  sendJson(response, 403, { error: "local_origin_required" });
  return true;
}

function serveRecorder(request: IncomingMessage, response: ServerResponse): void {
  const serve = handleRequest;
  if (!serve) {
    sendJson(response, 503, { error: "recorder_not_started" });
    return;
  }
  if (writeRefused(request, response)) return;
  serve(request, response);
}

export async function handleBrowserRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = request.url ?? "/";
  const route = classifyBrowserPath(url);
  try {
    switch (route.kind) {
      case "cloud":
        await dispatchCloudRequest(request, response, guardedCloudHandler);
        return;
      case "self-device": {
        if (writeRefused(request, response)) return;
        if (request.method === "POST") {
          const { clientId } = JSON.parse((await readBody(request)).toString() || "{}") as {
            clientId?: number | null;
          };
          writeSelfDevice(clientId ?? null);
          sendJson(response, 200, { clientId: readSelfDevice() });
          return;
        }
        sendJson(response, 200, { clientId: readSelfDevice() });
        return;
      }
      case "router-address": {
        if (writeRefused(request, response)) return;
        const answer = () =>
          sendJson(response, 200, {
            router: readRouterAddress(),
            routerDefault: ROUTER_LAN_ADDRESS,
          });
        if (request.method === "GET") return answer();
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        const { address } = JSON.parse((await readBody(request)).toString() || "{}") as {
          address?: string | null;
        };
        if (address === null || address === undefined || address === "") {
          try {
            rmSync(ROUTER_ADDRESS_FILE);
          } catch {
            /* already the default */
          }
          return answer();
        }
        const normalized = normalizeIpAddress(address);
        if (!normalized) {
          sendJson(response, 400, { error: "invalid" });
          return;
        }
        writeFileSync(ROUTER_ADDRESS_FILE, normalized, "utf8");
        return answer();
      }
      case "whoami": {
        const injected = identityFromEnv();
        sendJson(response, 200, {
          ips: injected?.ipAddresses ?? [],
          macs: injected?.macAddresses ?? [],
        });
        return;
      }
      case "api":
        serveRecorder(request, response);
        return;
      case "dish":
        await proxyTo(DISH_ORIGIN + route.path, request, response, await readBody(request), 10_000);
        return;
      case "router": {
        const path = route.path;
        const body = await readBody(request);
        if (ROUTER_URL_OVERRIDE) {
          const origin = originOf(ROUTER_URL_OVERRIDE);
          await proxyTo(origin + path, request, response, body, 10_000);
          return;
        }
        const upstream = await routerOrigins.run((origin) =>
          fetch(origin + path, {
            method: request.method,
            headers: forwardableHeaders(request),
            body:
              request.method === "GET" || request.method === "HEAD"
                ? undefined
                : (body as BodyInit),
            signal: AbortSignal.timeout(10_000),
          }),
        );
        upstream.headers.forEach((value, name) => {
          if (!SKIP_RESPONSE_HEADERS.has(name)) response.setHeader(name, value);
        });
        response.statusCode = upstream.status;
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      case "celestrak":
        await proxyTo(
          CELESTRAK_ORIGIN + route.path,
          request,
          response,
          await readBody(request),
          30_000,
        );
        return;
      case "speedtest":
        await proxyTo(
          SPEEDTEST_ORIGIN + route.path,
          request,
          response,
          await readBody(request),
          60_000,
        );
        return;
      case "static":
        serveStatic(url, response);
        return;
    }
  } catch (error) {
    if (response.headersSent) return;
    sendText(response, 502, `${route.kind} unreachable: ${(error as Error).message}`);
  }
}

createServer((request, response) => {
  void handleBrowserRequest(request, response);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`[browser-host] http://0.0.0.0:${PORT}  (dish: ${DISH_ORIGIN})`);
  console.log(`[browser-host] UI from ${DIST}`);
  if (handleRequest)
    console.log(
      `[browser-host] recording to ${process.env.HISTORIAN_DATA_DIR}. Stop any other recorder on this router: two double its 200 ms client poll.`,
    );
  if (readSelfDevice() === null)
    console.warn(
      "[browser-host] no device named under Settings → App: pausing is refused until one is, since a pause aimed at this dashboard's own device cannot be undone from it.",
    );
});
