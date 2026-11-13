// Dev-server route to the Starlink dish.
//
// Replaces the static `server.proxy` entry that used to pin /dishy at
// 192.168.100.1, so a dev run follows the same address the settings row writes:
// a Mini behind another router is reachable only at the address that router
// forwards the dish's port to, and a fixed proxy target cannot express that.
//
// Body handling matches dev/routerProxy: grpc-web frames are bytes, and the
// dish drops a request that carries a browser Referer/Origin.

import type { IncomingMessage, ServerResponse } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";
import { DISH_LAN_ADDRESS } from "../core/dishClient";
import { dishOriginFrom } from "../core/dishEndpoint";
import { normalizeIpAddress } from "../core/ipAddress";
import { DEV_DISH_ADDRESS_FILE, readDevDishAddress } from "../collector/devDishAddress.mts";
import { SKIP_RESPONSE_HEADERS, forwardableHeaders, readBody } from "./routerProxy";

/** An explicit DISH_URL still wins, for pointing a dev run at a stand-in. */
const DISH_ORIGIN_OVERRIDE = process.env.DISH_URL ? new URL(process.env.DISH_URL).origin : null;

export function dishProxy(): Plugin {
  return {
    name: "starlink-dish-proxy",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";

        if (url === "/dish-address") {
          const answer = () => {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                dish: readDevDishAddress(),
                dishDefault: DISH_LAN_ADDRESS,
              }),
            );
          };
          if (req.method === "GET") return answer();
          if (req.method === "POST") {
            const { address } = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
              address?: string | null;
            };
            if (address === null || address === undefined || address === "") {
              rmSync(DEV_DISH_ADDRESS_FILE, { force: true });
              return answer();
            }
            const normalized = normalizeIpAddress(address);
            if (!normalized) {
              res.statusCode = 400;
              res.setHeader("content-type", "application/json");
              return res.end(JSON.stringify({ error: "invalid" }));
            }
            writeFileSync(DEV_DISH_ADDRESS_FILE, normalized, "utf8");
            return answer();
          }
          res.statusCode = 405;
          return res.end();
        }

        if (!url.startsWith("/dishy/")) return next();

        const path = url.slice("/dishy".length);
        const headers = forwardableHeaders(req);
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const body = hasBody ? await readBody(req) : undefined;

        try {
          const origin = DISH_ORIGIN_OVERRIDE ?? dishOriginFrom(readDevDishAddress());
          const upstream = await fetch(origin + path, {
            method: req.method,
            headers,
            body: body as BodyInit | undefined,
            signal: AbortSignal.timeout(10_000),
          });
          upstream.headers.forEach((value, name) => {
            if (!SKIP_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
          });
          res.statusCode = upstream.status;
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          // Nobody answered. A 502 keeps this distinguishable from the dish
          // answering with an error of its own.
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain");
          res.end(`dish unreachable: ${(error as Error).message}`);
        }
      });
    },
  };
}
