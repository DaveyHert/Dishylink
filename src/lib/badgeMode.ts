// What the extension's toolbar badge counts. Only the extension binds this: no
// other host keeps a standing alert count in the browser chrome.

import type { AlertState } from "@core/alertDefinitions";

export type BadgeMode =
  /** Every alert, unreachability included. */
  | "all"
  /** Only faults a device reported about itself. */
  | "faults"
  /** No badge, ever. */
  | "off";

export const DEFAULT_BADGE_MODE: BadgeMode = "all";

export function isBadgeMode(value: unknown): value is BadgeMode {
  return value === "all" || value === "faults" || value === "off";
}

/** A healthy dish drops its link many times an hour as satellites hand over, so
 *  counting outages would sit permanently lit over something needing nothing. */
function badgeWorthy(alert: AlertState): boolean {
  return !(alert.source === "system" && alert.key === "starlinkOutage");
}

/** Being away from the network raises unreachability exactly as a dead device
 *  does, and nothing can tell those apart, so "faults" drops both. */
function reportedByDevice(alert: AlertState): boolean {
  return !(
    alert.source === "system" &&
    (alert.key === "dishUnreachable" || alert.key === "routerUnreachable")
  );
}

/** The alerts a badge in this mode stands for. */
export function badgeAlerts(active: AlertState[], mode: BadgeMode): AlertState[] {
  if (mode === "off") return [];
  const shown = active.filter(badgeWorthy);
  return mode === "faults" ? shown.filter(reportedByDevice) : shown;
}

export interface BadgeModeBinding {
  read: () => Promise<BadgeMode>;
  write: (mode: BadgeMode) => Promise<void>;
}

let binding: BadgeModeBinding | null = null;

/** Called once by a host entry point, before the UI renders. */
export function setBadgeModeHost(hostBinding: BadgeModeBinding): void {
  binding = hostBinding;
}

export function badgeModeHost(): BadgeModeBinding | null {
  return binding;
}
