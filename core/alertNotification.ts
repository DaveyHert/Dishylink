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

/**
 * Where notifications stand on this host: what the user asked for, and whether
 * the channel can actually reach them.
 *
 * Two facts, kept apart, because they answer to different things: the request is
 * the user's and persists, the channel's health is the OS's and changes under
 * the app. A single flag for both cannot be written by one without overwriting
 * the other's meaning. Kept separate, "is it on" is one derived rule
 * (`notificationsRequested`) that every surface applies to the same pair.
 */
export interface NotificationState {
  /**
   * Whether the user wants alerts announced. Only ever the request itself: a
   * channel that cannot deliver does not erase the answer, so a preference set
   * where notifications are refused still stands once they work.
   *
   * null means never asked, which is not the same as declined — see the
   * preference's own seeding note in the desktop host.
   */
  wanted: boolean | null;
  /** Whether the last attempt reached the user, so a control never claims to be
   *  on while nothing is arriving. Assumed true until an attempt says otherwise;
   *  nothing has failed yet, and refusing a working channel is the worse guess. */
  deliverable: boolean;
  /** Why nothing is arriving, phrased for the person looking at the control.
   *  Absent whenever `deliverable`. */
  reason?: string;
}

/**
 * Whether a control reads as on. The request alone, deliberately.
 *
 * A control shows what the user asked for, so that clicking it always changes
 * the answer. Folding delivery in would make an undeliverable channel read as
 * off, and then a click could only ever re-request — leaving no way to withdraw
 * a request that is already failing. Delivery is reported alongside instead, by
 * notificationsProblem.
 */
export function notificationsRequested(state: NotificationState): boolean {
  return state.wanted === true;
}

/**
 * What to say beside the control, or null when there is nothing to say.
 *
 * Only worth raising once notifications have been asked for: a channel that
 * cannot deliver is not a problem to someone who wants nothing delivered.
 */
export function notificationsProblem(state: NotificationState): string | null {
  if (state.wanted !== true || state.deliverable) return null;
  return state.reason ?? null;
}

/** The notification sent when the user switches them on: proof the channel works,
 *  and on macOS what raises the permission prompt. Shared so the tray and the
 *  alerts panel confirm in the same words. */
export const NOTIFICATIONS_ON_CONFIRMATION = {
  title: "Notifications on",
  body: "Dishylink will alert you about Starlink outages.",
};

function deviceName(source: AlertTransition["source"]): string {
  if (source === "dish") return "Dish";
  if (source === "router") return "Router";
  return "Dishylink";
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
