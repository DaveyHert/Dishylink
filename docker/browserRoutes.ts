export type BrowserRoute =
  | { kind: "cloud" }
  | { kind: "dish"; path: string }
  | { kind: "router"; path: string }
  | { kind: "api" }
  | { kind: "whoami" }
  | { kind: "celestrak"; path: string }
  | { kind: "speedtest"; path: string }
  | { kind: "static" };

/** Same path prefixes the Vite dev server exposes, so the Docker host and that
 *  harness keep one map of what the browser is allowed to ask for. */
export function classifyBrowserPath(url: string): BrowserRoute {
  const parsed = new URL(url, "http://local");
  const path = parsed.pathname || "/";
  const rest = parsed.search;
  if (path.startsWith("/cloud/")) return { kind: "cloud" };
  if (path === "/api/whoami") return { kind: "whoami" };
  if (path === "/api" || path.startsWith("/api/")) return { kind: "api" };
  if (path.startsWith("/dishy"))
    return { kind: "dish", path: (path.slice("/dishy".length) || "/") + rest };
  if (path.startsWith("/router"))
    return { kind: "router", path: (path.slice("/router".length) || "/") + rest };
  if (path.startsWith("/celestrak"))
    return { kind: "celestrak", path: (path.slice("/celestrak".length) || "/") + rest };
  if (path.startsWith("/speedtest"))
    return { kind: "speedtest", path: (path.slice("/speedtest".length) || "/") + rest };
  return { kind: "static" };
}
