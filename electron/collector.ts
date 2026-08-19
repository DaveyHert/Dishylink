// Runs the historian inside the Electron main process and bridges its Node-style
// request handler to the fetch Request/Response the app:// protocol speaks. No port
// is opened: /api requests are served entirely in-process. The historian writes to
// the per-user app-data directory, so a packaged install keeps its own history and
// starts empty (end users seed nothing; only the developer copies existing data in).

import { app } from "electron";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AlertTransition } from "../core/alertEngine";
import { preferences } from "./preferences";
import { accountSignedIn, pauseDevice } from "./cloud";
import type { ThroughputSample } from "../collector/historian.mts";

export type { ThroughputSample };

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;
type AlertListener = (transitions: AlertTransition[]) => void;
type ThroughputListener = (sample: ThroughputSample) => void;
let handleRequest: NodeHandler | null = null;
let subscribeToAlerts: ((listener: AlertListener) => () => void) | null = null;
let subscribeToThroughput: ((listener: ThroughputListener) => () => void) | null = null;
let enableLiveThroughput: ((enabled: boolean) => void) | null = null;

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
  // The recorder dials the router with no window open, so it reads the same
  // preference the window edits rather than the default it was built with.
  historian.setRouterAddressReader(() => preferences().routerAddress);
  // A device that spends its data allowance is paused from here, through the
  // account session this process holds. The recorder decides; only main can send.
  historian.setDevicePauser((clientId, paused) => pauseDevice(clientId, paused));
  historian.setAccountSessionReader(() => accountSignedIn());
  handleRequest = historian.handleRequest;
  subscribeToAlerts = historian.onAlertTransitions;
  subscribeToThroughput = historian.onThroughput;
  enableLiveThroughput = historian.setLiveThroughputEnabled;
  // Last: the first poll can reach a rule that owes a pause, and the pauser above
  // is what sends it.
  historian.start();
}

/**
 * Watch the recorder's alert transitions.
 *
 * This is what lets the app tell someone the dish went offline while no window
 * exists. The recorder polls both devices every 5s in this process and the
 * engine it drives reports every edge; nothing here depends on a renderer being
 * alive to notice one.
 */
export function onAlertTransitions(listener: AlertListener): () => void {
  return subscribeToAlerts?.(listener) ?? (() => {});
}

/**
 * Watch the recorder's live throughput — the once-a-second dish reading the
 * menu-bar readout shows while no window is open.
 *
 * The feed is silent until switched on with setLiveThroughputEnabled, and only its
 * owner does that, in the gap where no window is running the equivalent poll. A
 * subscriber that arrives before the collector has started gets a no-op unsubscribe
 * and the real feed once it runs.
 */
export function onThroughput(listener: ThroughputListener): () => void {
  return subscribeToThroughput?.(listener) ?? (() => {});
}

/**
 * Start or stop the recorder's once-a-second throughput poll of the dish.
 *
 * Its owner drives this from its own gate — on only while the readout is showing
 * and no window is polling the dish itself — so the dish is never asked twice a
 * second. A no-op until the collector has started (a dev main leaves it unstarted
 * and lets the separate dev historian record instead).
 */
export function setLiveThroughputEnabled(enabled: boolean): void {
  enableLiveThroughput?.(enabled);
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
