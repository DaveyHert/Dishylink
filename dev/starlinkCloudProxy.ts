// Dev-only binding for the cloud account feature.
//
// The browser cannot call starlink.com directly (CORS: ACAO is starlink.com-only;
// the session cookies are HttpOnly/SameSite so JS can't attach them). In the
// shipping products this transport lives in Electron main / the extension's
// background worker; in dev it lives here, as a Vite middleware. The request logic
// is the host-agnostic createCloudHandler; this file only wires it to a file cookie
// store and exposes the /cloud/* routes the UI reads.

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createCloudHandler } from "../cloud/starlinkCloudHandler.ts";
import { DishClient, ROUTER_LAN_HANDLE_URL } from "../core/dishClient.ts";
import { prepareRouterClientUpdate } from "../core/routerClientUpdate.ts";
import type { RouterClientUpdate } from "../core/routerClientUpdate.ts";
import { localNetworkIdentity } from "../core/hostNetworkIdentity.ts";

const COOKIE_FILE = resolve(process.cwd(), ".starlink-cookie");

function readCookie(): string | null {
  try {
    return readFileSync(COOKIE_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

function writeCookie(cookie: string): void {
  writeFileSync(COOKIE_FILE, cookie, "utf8");
}

function clearCookie(): void {
  try {
    rmSync(COOKIE_FILE);
  } catch {
    /* already gone */
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

// A text/plain POST is a CORS simple request: no preflight, so a page on any site
// lands the write without ever reading the reply. Loopback binding is no defence,
// the request comes from a browser on this machine.
function isLocalOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolveBody(data));
    req.on("error", reject);
  });
}

/** Vite plugin: serves /cloud/* from the user's own starlink.com session, held in
 *  a local .starlink-cookie file. */
export function starlinkCloudProxy(): Plugin {
  return {
    name: "starlink-cloud-proxy",
    configureServer(server) {
      let routerPromise: Promise<DishClient> | null = null;
      const handler = createCloudHandler({
        readCookie,
        writeCookie,
        clearCookie,
        prepareDeviceUpdate: async (update) => {
          routerPromise ??= DishClient.load("router", {
            handleUrl: ROUTER_LAN_HANDLE_URL,
            protosetBytes: new Uint8Array(
              readFileSync(resolve(process.cwd(), "public/dish.protoset")),
            ),
          });
          return prepareRouterClientUpdate(await routerPromise, update, localNetworkIdentity());
        },
      });
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/cloud/")) return next();
        if (!isLocalOrigin(req.headers.origin))
          return sendJson(res, 403, { error: "forbidden_origin" });
        const route = url.split("?")[0];

        // Connect / disconnect the session pasted from the UI.
        if (route === "/cloud/session") {
          if (req.method === "DELETE") {
            const { status, body } = handler.disconnect();
            return sendJson(res, status, body);
          }
          if (req.method === "POST") {
            try {
              const { cookie } = JSON.parse((await readBody(req)) || "{}") as { cookie?: string };
              const { status, body } = await handler.connect(cookie ?? "");
              return sendJson(res, status, body);
            } catch {
              return sendJson(res, 400, {
                error: "bad_request",
                message: "Expected JSON { cookie }.",
              });
            }
          }
          return sendJson(res, 405, { error: "method_not_allowed" });
        }

        if (route === "/cloud/device" && req.method === "POST") {
          try {
            const update = JSON.parse((await readBody(req)) || "{}") as RouterClientUpdate;
            const result = await handler.updateClient(update);
            return sendJson(res, result.status, result.body);
          } catch (error) {
            return sendJson(res, 400, { error: "bad_request", message: (error as Error).message });
          }
        }

        const { status, body } = await handler.handle(route);
        sendJson(res, status, body);
      });
    },
  };
}
