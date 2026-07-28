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
