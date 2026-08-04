// Dev-server route to the Starlink router, replacing a plain `server.proxy`
// entry so the request can be retried against a second address.
//
// The router's IPv4 address is one another router can be using, in which case it
// answers from an IPv6 address instead (see core/routerEndpoint). Retrying needs
// the request body a second time, and a proxy that streams the body has already
// spent it by the time the first attempt fails — so it is buffered here and each
// attempt sends its own copy.
//
// Bytes, not a string: this carries grpc-web frames, and decoding them as text
// corrupts every non-UTF8 byte in the payload.

import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import type { Plugin } from "vite";
import { createRouterOrigins } from "../core/routerEndpoint";

/** Set by the response itself, or meaningless once fetch has decoded the body. */
const SKIP_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** The dish drops requests carrying a browser Referer/Origin it does not know,
 *  and the router is the same service — so neither is forwarded. */
function forwardableHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === "referer" || lower === "origin" || lower === "host") continue;
    if (lower === "connection" || lower === "content-length") continue;
    headers.set(lower, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

export function routerProxy(): Plugin {
  const origins = createRouterOrigins(() =>
    Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv6" && !entry.internal)
      .map((entry) => entry!.address),
  );

  return {
    name: "starlink-router-proxy",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/router/")) return next();

        const path = url.slice("/router".length);
        const headers = forwardableHeaders(req);
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const body = hasBody ? await readBody(req) : undefined;

        try {
          const upstream = await origins.run((origin) =>
            fetch(origin + path, {
              method: req.method,
              headers,
              body: body as BodyInit | undefined,
              signal: AbortSignal.timeout(10_000),
            }),
          );
          upstream.headers.forEach((value, name) => {
            if (!SKIP_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
          });
          res.statusCode = upstream.status;
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          // Nobody answered at any address. A 502 keeps this distinguishable
          // from the router answering with an error of its own.
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain");
          res.end(`router unreachable: ${(error as Error).message}`);
        }
      });
    },
  };
}
