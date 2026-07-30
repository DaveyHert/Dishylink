// Which host answers /api/* — the recorded-history routes the historian serves.
//
// The renderer asks for a path and never for a host. A page whose own origin
// already serves /api/* (the Vite dev server proxying the historian, or the
// packaged desktop app over app://) needs no binding: the default is a plain
// fetch. A renderer with no server behind its origin — the browser extension,
// whose history lives in IndexedDB behind the service worker — registers its own
// transport instead of adding a branch at every call site.
//
// The transport is fetch-shaped: (path, init) => Response. Keeping the fetch
// contract means a call site swaps `fetch(` for `apiRequest(` and nothing else —
// `.ok`, `.status`, and `.json()` all read the same. A message-passing host
// rebuilds a Response from the reply it gets back, the same shape the desktop
// app's app:// handler already returns.

export type ApiTransport = (path: string, init?: RequestInit) => Promise<Response>;

const sameOriginFetch: ApiTransport = (path, init) => fetch(path, init);

let transport: ApiTransport = sameOriginFetch;

/** Called once by a host entry point, before the UI renders. */
export function setApiHost(binding: { transport: ApiTransport }): void {
  transport = binding.transport;
}

export function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  return transport(path, init);
}

/**
 * Whether the recorder runs inside the process that answers /api.
 *
 * It matters because "the history recorder is down" is only a condition that can
 * exist across a boundary. In a browser tab the recorder is a separate service
 * that really can die while the page keeps running, and saying so is useful. In
 * the desktop app it runs in the main process, which is also what serves /api
 * and owns this window — if it had died there would be nothing left to ask, and
 * nothing to display the answer. A request that fails there means the app was
 * briefly busy, not that recording has stopped, and reporting it as a warning
 * teaches the user to distrust a panel that is otherwise telling the truth.
 */
let recorderInProcess = false;

/** Declared once by a host whose own process runs the recorder. */
export function setRecorderInProcess(value: boolean): void {
  recorderInProcess = value;
}

export function recorderRunsInHostProcess(): boolean {
  return recorderInProcess;
}
