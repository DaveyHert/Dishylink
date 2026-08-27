export type BrowserRoute =
  | { kind: "cloud" }
  | { kind: "dish"; path: string }
  | { kind: "router"; path: string }
  | { kind: "api" }
  | { kind: "whoami" }
  | { kind: "self-device" }
  | { kind: "router-address" }
  | { kind: "celestrak"; path: string }
  | { kind: "speedtest"; path: string }
  | { kind: "static" };

/** The remainder after a whole path segment, or null when `prefix` is only a
 *  string prefix of it. Anything less anchored lets `/celestrak.example.com`
 *  through as a celestrak path, and the origin it is concatenated onto then
 *  names a host the caller chose. */
function afterSegment(path: string, prefix: string): string | null {
  if (path === prefix) return "/";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : null;
}

/** Same path prefixes the Vite dev server exposes, so the Docker host and that
 *  harness keep one map of what the browser is allowed to ask for. */
export function classifyBrowserPath(url: string): BrowserRoute {
  const parsed = new URL(url, "http://local");
  const path = parsed.pathname || "/";
  const rest = parsed.search;
  if (path.startsWith("/cloud/")) return { kind: "cloud" };
  if (path === "/api/whoami") return { kind: "whoami" };
  if (path === "/api/self-device") return { kind: "self-device" };
  if (path === "/api" || path.startsWith("/api/")) return { kind: "api" };
  if (path === "/router-address") return { kind: "router-address" };
  const dish = afterSegment(path, "/dishy");
  if (dish !== null) return { kind: "dish", path: dish + rest };
  const router = afterSegment(path, "/router");
  if (router !== null) return { kind: "router", path: router + rest };
  const celestrak = afterSegment(path, "/celestrak");
  if (celestrak !== null) return { kind: "celestrak", path: celestrak + rest };
  const speedtest = afterSegment(path, "/speedtest");
  if (speedtest !== null) return { kind: "speedtest", path: speedtest + rest };
  return { kind: "static" };
}
