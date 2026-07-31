// The dashboard's bridge to the background worker, so the shared notifications UI
// treats the extension the way it treats the desktop: a host that announces
// alerts from its own always-on process and owns the on/off preference.
//
// The worker is the extension's counterpart to the desktop main process — it is
// awake on the alarm with no window, so it posts the OS notification for any alert
// the user is not already looking at; a dashboard in front sounds its own chime
// while the worker holds the toast back (see hostAnnouncesAlerts, and the worker's
// dashboardIsForeground). The preference therefore has to live where the worker
// can read it: chrome.storage.local, not the page's localStorage, which a service
// worker cannot see. The dashboard page can reach storage directly; only the toast
// itself has to cross to the worker, so a real alert and the toggle's confirmation
// take the exact same path.

import { browser } from "wxt/browser";
import type { NotificationState } from "@core/alertNotification";

/** Where the on/off preference lives — read by the worker before every announce,
 *  written by the toggle here. Shared with the background entry. */
export const NOTIFICATIONS_ENABLED_KEY = "notificationsEnabled";

/** The worker's reply to a notify request: it created the toast, or it couldn't.
 *  It cannot know whether the OS then displayed it — the same blind spot the
 *  desktop documents for macOS — so "delivered" means "handed to the browser". */
export interface NotifyResult {
  delivered: boolean;
  reason?: string;
}

/** Why the last notification failed to reach the user, or null while they are
 *  arriving. Held here rather than in storage: it describes this browser session's
 *  channel, not a setting, and a stale one read at startup would be a warning
 *  about something that may since have started working. */
let notificationFailureReason: string | null = null;

async function storedRequest(): Promise<boolean | null> {
  const stored = await browser.storage.local.get(NOTIFICATIONS_ENABLED_KEY);
  return NOTIFICATIONS_ENABLED_KEY in stored ? stored[NOTIFICATIONS_ENABLED_KEY] === true : null;
}

function stateFrom(wanted: boolean | null): NotificationState {
  return notificationFailureReason === null
    ? { wanted, deliverable: true }
    : { wanted, deliverable: false, reason: notificationFailureReason };
}

export const extensionNotificationHost = {
  async notify(title: string, body: string): Promise<NotifyResult> {
    const result = (await browser.runtime.sendMessage({ type: "notify", title, body })) as
      NotifyResult | undefined;
    const answered = result ?? {
      delivered: false,
      reason: "The background worker didn’t answer.",
    };
    notificationFailureReason = answered.delivered ? null : (answered.reason ?? null);
    return answered;
  },
  /** `wanted: null` when the user has made no choice yet, so the dashboard can seed
   *  it from the old localStorage flag the way the desktop seeds from its own. */
  async notificationState(): Promise<NotificationState> {
    return stateFrom(await storedRequest());
  },
  async setNotificationsWanted(wanted: boolean): Promise<NotificationState> {
    await browser.storage.local.set({ [NOTIFICATIONS_ENABLED_KEY]: wanted });
    return stateFrom(wanted);
  },
  /** Follows the stored request, which is what a second dashboard tab changes when
   *  it toggles the same setting. The worker only reads it, so writes seen here are
   *  always another page's — or this one's own, harmlessly repeating what it just set. */
  onNotificationState(listener: (state: NotificationState) => void): () => void {
    const handler = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area !== "local" || !(NOTIFICATIONS_ENABLED_KEY in changes)) return;
      const next = changes[NOTIFICATIONS_ENABLED_KEY].newValue;
      listener(stateFrom(next === undefined ? null : next === true));
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  },
};
