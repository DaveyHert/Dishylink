// How an alert transition reads when it reaches a person, and how often.
//
// The engine decides what changed; this decides what to say about it and
// whether to say it again. Both answers have to be identical everywhere — a
// desktop notification and a browser one describing the same dish differently
// is the same failure as the panel and the history log disagreeing — so the
// wording and the repeat rule live here rather than beside each transport.
//
// What stays with each host is only the transport itself: macOS notifications
// from the Electron main process, chrome.notifications from the extension's
// background worker, the web Notification API in a tab.

import type { AlertSeverity } from "./alertDefinitions";
import type { AlertTransition } from "./alertEngine";

/** One alert, worded for a person, ready for whatever transport the host has. */
export interface AlertNotification {
  /**
   * Identifies this notification for throttling. The onset and the clear carry
   * different keys on purpose: a recovery arriving a second after the onset is
   * news, and sharing a key would let the onset's throttle swallow it.
   */
  key: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  /** An alert ending rather than starting. Hosts that pick a sound need it: a
   *  recovery gets the single soft note, not the severity's own tone. */
  cleared: boolean;
}

function deviceName(source: AlertTransition["source"]): string {
  if (source === "dish") return "Dish";
  if (source === "router") return "Router";
  return "DishyLink";
}

/**
 * What to tell the user about a transition, or null when it is not worth
 * interrupting them for. `notify` on the definition is the whole test, so no
 * alert can be watched without also being notifiable, and no host can quietly
 * decide to announce something the others stay silent about.
 */
export function describeTransition(transition: AlertTransition): AlertNotification | null {
  if (!transition.spec.notify) return null;
  const cleared = transition.kind === "cleared";
  const device = deviceName(transition.source);
  return {
    key: `alert-${transition.source}:${transition.key}${cleared ? "-cleared" : ""}`,
    title: cleared ? `${device} alert cleared` : `${device} alert`,
    body: cleared ? transition.spec.ok : transition.spec.firing,
    severity: transition.spec.severity,
    cleared,
  };
}

/** A minute. Long enough that a flapping link cannot become a storm, short
 *  enough that a genuine recurrence still reaches someone. */
export const NOTIFICATION_THROTTLE_MS = 60_000;

/**
 * Rate-limits one notification key, so a condition crossing its threshold
 * repeatedly reaches the user once rather than once per poll. Every host that
 * delivers needs this, and the recorder's 5s cadence needs it most.
 */
export class NotificationThrottle {
  private lastSentAtByKey = new Map<string, number>();

  constructor(private readonly windowMs: number = NOTIFICATION_THROTTLE_MS) {}

  /** Whether this key may be sent now. Records the send when the answer is yes,
   *  so callers cannot forget to. */
  allow(key: string, nowMs: number): boolean {
    const lastSentAt = this.lastSentAtByKey.get(key);
    if (lastSentAt !== undefined && nowMs - lastSentAt < this.windowMs) return false;
    this.lastSentAtByKey.set(key, nowMs);
    return true;
  }
}
