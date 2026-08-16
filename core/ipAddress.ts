// Literal IP addresses the user types: where the router is, and which DNS servers
// it should forward to.
//
// Validation is deliberately narrow — a literal IPv4 or IPv6 address, nothing
// else. A hostname would need a resolver, and every host here (a service worker,
// the Electron main process, a launchd service) resolves differently or not at
// all; accepting one would mean four behaviours wearing one setting's name.

/** What a host answers when asked where it dials the router. The default rides
 *  along so a window can show it as a placeholder without keeping its own copy. */
export interface RouterAddress {
  router: string | null;
  routerDefault: string;
}

/** The eight hextets of `address`, or null when it is not an IPv6 address this
 *  can reason about. Handles "::" in any position; rejects the IPv4-embedded
 *  forms, which carry dots and are not what a Starlink prefix looks like. */
export function expandIpv6(address: string): string[] | null {
  const bare = address.split("%")[0].trim().toLowerCase(); // drop any zone
  if (bare === "" || bare.includes(".")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const left = groupsOf(halves[0]);
  const right = halves.length === 2 ? groupsOf(halves[1]) : [];
  const full =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (full.length !== 8 || full.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return full;
}

/** An address as typed, reduced to the canonical form the origin is built from,
 *  or null when it is not an address this can dial. Surrounding whitespace and
 *  the brackets an IPv6 address is often pasted with are tolerated. */
export function normalizeIpAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;

  if (isIpv4(unbracketed)) return unbracketed;

  // A zone id ("%en0") is dropped rather than rejected: it is meaningful only to
  // link-local addresses, which WHATWG URL refuses outright, so an address that
  // needs one cannot be dialled from here whatever we do with it.
  const withoutZone = unbracketed.split("%")[0];
  if (expandIpv6(withoutZone)) return withoutZone.toLowerCase();

  return null;
}

/** Dotted quad, each octet 0-255, no leading zeros (which some resolvers read as
 *  octal). Written out rather than regex-golfed so the bounds are visible. */
function isIpv4(candidate: string): boolean {
  const octets = candidate.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    if (octet.length > 1 && octet.startsWith("0")) return false;
    return Number(octet) <= 255;
  });
}

/** The http origin for an address, bracketing IPv6 as a URL requires. */
export function originFor(address: string, port: number): string {
  return address.includes(":") ? `http://[${address}]:${port}` : `http://${address}:${port}`;
}
