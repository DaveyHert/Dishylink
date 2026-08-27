/**
 * Whether a request's `Origin` is this machine or the LAN — the dashboard is
 * reached both at localhost and, from a phone, at the host's private address, so
 * both have to pass. A missing Origin is a non-browser client (curl, a script),
 * which is not the drive-by case this guards.
 *
 * Its own module so a host published on every interface can apply it without
 * importing the recorder, whose loading claims the data directory.
 */
export function isLocalOrigin(origin?: string): boolean {
  if (!origin) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "::1" || /^127\./.test(hostname)) return true;
  // A name with no dot is a bare LAN hostname; a public site always has one.
  if (!hostname.includes(".")) return true;
  if (/\.(local|internal|home\.arpa|ts\.net)$/.test(hostname)) return true;
  // RFC1918 private ranges.
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  // Tailscale and other CGNAT (100.64.0.0/10), plus link-local and IPv6 ULA.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(hostname);
}
