// Which host is answering /cloud/*, and what else that host can do.
//
// The request logic lives once in cloud/starlinkCloudHandler.ts; each host binds
// it to its own session store — dev's .starlink-cookie file, Electron's keychain,
// the extension's chrome.cookies. This module is the renderer-side half of that
// split. The UI asks for a capability and never for a host name, so a new host
// registers itself here instead of adding a branch at every call site.

export interface CloudRequest {
  path: string;
  method?: string;
  /** JSON-serialized into the request body when present. */
  body?: unknown;
  /** Honoured by hosts that fetch; message-passing hosts settle on their own. */
  signal?: AbortSignal;
}

export interface CloudReply {
  status: number;
  body: unknown;
}

export type CloudTransport = (request: CloudRequest) => Promise<CloudReply>;
export type CloudSignIn = () => Promise<{ ok: boolean; message?: string }>;

/**
 * The default: a page whose own origin already serves /cloud/*. That is the
 * browser on the Vite dev server, and the packaged desktop app over app://.
 * Hosts with no server behind the renderer's origin — Electron on the dev
 * server, the extension — register a message channel over this instead.
 */
const sameOriginTransport: CloudTransport = async ({ path, method = "GET", body, signal }) => {
  const response = await fetch(path, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  // Every /cloud/* route answers JSON, including its errors; a body that will not
  // parse means something other than the binding replied, and the status carries
  // enough for the caller to raise.
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

let transport: CloudTransport = sameOriginTransport;
let hostSignIn: CloudSignIn | undefined;

/** Called once by a host entry point, before the UI renders. */
export function setCloudHost(binding: { transport?: CloudTransport; signIn?: CloudSignIn }): void {
  if (binding.transport) transport = binding.transport;
  if (binding.signIn) hostSignIn = binding.signIn;
}

export function cloudRequest(request: CloudRequest): Promise<CloudReply> {
  return transport(request);
}

const sessionListeners = new Set<() => void>();

/**
 * Announce that the stored session changed — connected, replaced, or cleared.
 * Every cached cloud answer in the app is stale the moment this fires, including
 * the "not connected" ones, so this is what makes a fresh sign-in visible without
 * a reload.
 */
export function noteCloudSessionChanged(): void {
  for (const listener of [...sessionListeners]) listener();
}

export function subscribeCloudSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/**
 * The host's own sign-in, or undefined where the user has to paste a session.
 * A plain browser page is the undefined case for good: it cannot read
 * starlink.com's HttpOnly cookies, whatever it does with a button.
 */
export function cloudSignIn(): CloudSignIn | undefined {
  const run = hostSignIn;
  if (!run) return undefined;
  return async () => {
    const result = await run();
    // A host sign-in connects the account inside the host's own process, never
    // through connectCloud — so without this nothing in the app would learn that
    // its cached answers are now wrong. Announcing it here means no caller, this
    // one or the extension's later, can forget to.
    if (result.ok) noteCloudSessionChanged();
    return result;
  };
}
