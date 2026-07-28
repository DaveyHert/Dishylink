// Runs the historian inside the Electron main process and bridges its Node-style
// request handler to the fetch Request/Response the app:// protocol speaks. No port
// is opened: /api requests are served entirely in-process. The historian writes to
// the per-user app-data directory, so a packaged install keeps its own history and
// starts empty (end users seed nothing; only the developer copies existing data in).

import { app } from "electron";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;
let handleRequest: NodeHandler | null = null;

/**
 * Start the historian in this process. It is configured through the same env the
 * dev process uses, set before the module is imported so its stores initialize
 * against the right paths; HISTORIAN_EMBED keeps it from opening an HTTP port.
 */
export async function startCollector(rendererRoot: string): Promise<void> {
  process.env.HISTORIAN_DATA_DIR = join(app.getPath("userData"), "data");
  process.env.HISTORIAN_EMBED = "1";
  // The protoset ships beside the renderer bundle; point the historian at it
  // rather than its dev-tree default under public/.
  process.env.HISTORIAN_PROTOSET = join(rendererRoot, "dish.protoset");
  const historian = await import("../collector/historian.mts");
  handleRequest = historian.handleRequest;
}

/**
 * Serve one /api request by driving the historian's handler with a minimal Node
 * request/response pair and collecting what it writes into a fetch Response. The
 * request is same-machine and trusted, so it is presented as a loopback origin,
 * which is what the handler's own write-protection expects.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  if (!handleRequest) return new Response("collector not started", { status: 503 });

  const url = new URL(request.url);
  const headers: Record<string, string> = { origin: "http://localhost" };
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const nodeRequest = {
    url: url.pathname + url.search,
    method: request.method,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;

  return new Promise<Response>((resolve) => {
    const chunks: Buffer[] = [];
    const responseHeaders: Record<string, string> = {};
    const nodeResponse = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
      },
      end(body?: string | Buffer) {
        if (body) chunks.push(Buffer.from(body));
        resolve(
          new Response(Buffer.concat(chunks), {
            status: nodeResponse.statusCode,
            headers: responseHeaders,
          }),
        );
      },
    };
    try {
      handleRequest!(nodeRequest, nodeResponse as unknown as ServerResponse);
    } catch (error) {
      resolve(new Response(`collector error: ${(error as Error).message}`, { status: 500 }));
    }
  });
}
