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
import { resilientFetch } from "../cloud/resilientFetch.ts";
import { CollectorBusyError } from "../collector/collectorLock.mts";
import { DishClient, DISH_LAN_HANDLE_URL, ROUTER_LAN_HANDLE_URL } from "../core/dishClient.ts";
import type { DishConfigJson } from "../core/dishClient.ts";
import { prepareDishConfigUpdate } from "../core/dishConfigUpdate.ts";
import {
  buildRouterConfigRequest,
  readCurrentNetworks,
  readCurrentSubnet,
  readRouterWifiConfig,
  type RouterConfigUpdate,
} from "../core/routerConfigUpdate.ts";
import { prepareRouterClientUpdate, readRouterClients } from "../core/routerClientUpdate.ts";
import type { RouterClientUpdate } from "../core/routerClientUpdate.ts";
import { localNetworkIdentity } from "../core/hostNetworkIdentity.ts";

const COOKIE_FILE = resolve(process.cwd(), ".starlink-cookie");

/** null, never "", so every reader agrees on what "no session" looks like. */
function readCookie(): string | null {
  try {
    return readFileSync(COOKIE_FILE, "utf8").trim() || null;
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
    async configureServer(server) {
      let routerPromise: Promise<DishClient> | null = null;
      let dishPromise: Promise<DishClient> | null = null;
      const protosetBytes = () =>
        new Uint8Array(readFileSync(resolve(process.cwd(), "public/dish.protoset")));
      // Every router callback needs the same client, and the gateway ones need it
      // only as a codec — loading it dials nothing.
      const loadRouter = () =>
        (routerPromise ??= DishClient.load("router", {
          handleUrl: ROUTER_LAN_HANDLE_URL,
          protosetBytes: protosetBytes(),
        }));
      const handler = createCloudHandler({
        fetch: resilientFetch,
        readCookie,
        writeCookie,
        clearCookie,
        prepareDeviceUpdate: async (update, targetId, callGateway) =>
          prepareRouterClientUpdate(
            await loadRouter(),
            update,
            targetId,
            callGateway,
            localNetworkIdentity(),
          ),
        prepareDishConfigUpdate: async (changes) => {
          dishPromise ??= DishClient.load("dish", {
            handleUrl: DISH_LAN_HANDLE_URL,
            protosetBytes: protosetBytes(),
          });
          return prepareDishConfigUpdate(await dishPromise, changes);
        },
        // Encoding only — the client is never dialled here, so this works on a
        // kit whose router answers nothing on the LAN.
        prepareRouterConfigUpdate: async (update, targetId, callGateway) => {
          const client = await loadRouter();
          const networks = await readCurrentNetworks(update, client, targetId, callGateway);
          return client.encodeRequest(buildRouterConfigRequest(targetId, update, networks));
        },
        readRouterSubnet: async (targetId, callGateway) =>
          readCurrentSubnet(await loadRouter(), targetId, callGateway),
        readRouterClients: async (targetId, callGateway) =>
          readRouterClients(await loadRouter(), targetId, callGateway),
        readRouterConfig: async (targetId, callGateway) =>
          readRouterWifiConfig(await loadRouter(), targetId, callGateway),
      });

      // Vitest stands up its own dev server, which must not claim the data directory.
      if (!process.env.VITEST) {
        process.env.HISTORIAN_EMBED = "1";
        try {
          const historian = await import("../collector/historian.mts");
          historian.setAccountSessionReader(() => readCookie() !== null);
          historian.setDevicePauser(async (clientId, paused) => {
            const { status, body } = await handler.updateClient({
              kind: "pause",
              clientId,
              paused,
            });
            if (status === 200) return;
            const message = (body as { message?: string })?.message ?? `HTTP ${status}`;
            throw new Error(status === 428 ? "No Starlink account connected" : message);
          });
          server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
            if (!req.url?.startsWith("/api/")) return next();
            historian.handleRequest(req, res);
          });
          // Last: the first poll can reach a rule that owes a pause, and the
          // pauser above is what sends it.
          historian.start();
        } catch (error) {
          // A second dev server would serve a window that records nothing, so the
          // one collector already running is worth stopping this one over. The
          // port is not: Vite moves to the next, and the recorder moves with it.
          if (error instanceof CollectorBusyError) throw error;
          console.warn(
            `[dev] recorder not started: ${(error as Error).message}. /api is unanswered here.`,
          );
        }
      }

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

        if (route === "/cloud/dish-config" && req.method === "POST") {
          try {
            const changes = JSON.parse((await readBody(req)) || "{}") as DishConfigJson;
            const result = await handler.updateDishConfig(changes);
            return sendJson(res, result.status, result.body);
          } catch (error) {
            return sendJson(res, 400, { error: "bad_request", message: (error as Error).message });
          }
        }

        if (route === "/cloud/router-config" && req.method === "POST") {
          try {
            const update = JSON.parse((await readBody(req)) || "{}") as RouterConfigUpdate;
            const result = await handler.updateRouterConfig(update);
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
