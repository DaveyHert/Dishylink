// What the dish says about the routers downstream of it.
//
// Probed on a Gen 3 kit on 2026-08-21: a bypassed router stays listed with its
// `role` changed from CONTROLLER to BYPASSED and its lastSeen still refreshing,
// while a router that is merely off is dropped from the map entirely (verified
// 2026-07-29). Bypass is therefore read from the role, never from absence.

import type { DishStatusJson } from "./dishClient";

/** Backstop against an entry that lingers; the dish drops a dead node itself. */
const LAST_SEEN_MS = 60_000;

const BYPASSED_ROLE = "BYPASSED";

export type RouterPresence =
  /** A router is up and is expected to answer on the LAN. */
  | "present"
  /** In bypass mode: it serves nothing, by design. */
  | "bypassed"
  /** No router on the kit at all, or it is powered off. */
  | "absent";

/** Nanosecond epoch string → milliseconds, or null when unparseable. */
function lastSeenMs(value: string | undefined): number | null {
  if (value == null) return null;
  const ns = Number(value);
  return Number.isFinite(ns) && ns > 0 ? ns / 1e6 : null;
}

/**
 * The routers the dish is currently vouching for, by cloud DeviceId.
 *
 * connectedRouters carries the same ids with no timestamp, so it stands in only
 * when the timestamped map is absent altogether — re-adding those ids alongside
 * it would hand back the staleness the lastSeen check exists to filter.
 */
export function freshDownstreamRouterIds(
  dish: DishStatusJson | null,
  nowMs: number = Date.now(),
): string[] {
  const downstream = dish?.downstreamRouters;
  if (!downstream) return (dish?.connectedRouters ?? []).filter((id): id is string => !!id);
  const ids: string[] = [];
  for (const [routerId, entry] of Object.entries(downstream)) {
    const seenMs = lastSeenMs(entry?.lastSeen);
    // Listing the router at all is the dish's statement that the link is up.
    if (seenMs == null || nowMs - seenMs < LAST_SEEN_MS) ids.push(routerId);
  }
  return ids;
}

export function isBypassedRole(role: string | undefined): boolean {
  return role?.toUpperCase() === BYPASSED_ROLE;
}

/**
 * Why the router is or isn't expected to answer, according to the dish. Callers
 * pass null for an unreachable dish, whose last snapshot is no longer evidence.
 */
export function routerPresence(
  dish: DishStatusJson | null,
  nowMs: number = Date.now(),
): RouterPresence {
  const fresh = new Set(freshDownstreamRouterIds(dish, nowMs));
  if (fresh.size === 0) return "absent";
  const downstream = dish?.downstreamRouters;
  // connectedRouters carries no roles, so bypass cannot be read from it.
  if (!downstream) return "present";
  // A mesh node is never the bypassed one, so any entry claiming it settles it.
  for (const [routerId, entry] of Object.entries(downstream))
    if (fresh.has(routerId) && isBypassedRole(entry?.role)) return "bypassed";
  return "present";
}

/** Whether the router's silence on the LAN is expected rather than a fault. */
export function routerSilenceExpected(presence: RouterPresence | null): boolean {
  return presence === "bypassed" || presence === "absent";
}
