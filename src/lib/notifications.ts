// Browser notifications for connection events, opt-in via the topbar bell.
// Each notification kind is throttled so a flapping link can't spam.

import { unlockAlertSound, playAlertSound } from "./alertSound";

const ENABLED_STORAGE_KEY = "dishboard-notifications";
const THROTTLE_MS = 60_000;

const lastSentAtByKind = new Map<string, number>();

export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

export function notificationsEnabled(): boolean {
  return (
    notificationsSupported() &&
    Notification.permission === "granted" &&
    localStorage.getItem(ENABLED_STORAGE_KEY) === "on"
  );
}

/** Toggle notifications; resolves to the new enabled state. */
export async function toggleNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (notificationsEnabled()) {
    localStorage.setItem(ENABLED_STORAGE_KEY, "off");
    return false;
  }
  // Browsers only let audio start from a user gesture, and this toggle is the
  // one we get — open the context here so later alerts can actually chime.
  unlockAlertSound();
  const permission = await Notification.requestPermission();
  const granted = permission === "granted";
  localStorage.setItem(ENABLED_STORAGE_KEY, granted ? "on" : "off");
  if (granted) {
    sendNotification(
      "test",
      "Notifications on",
      "DishyLink will alert you about Starlink outages.",
    );
    // Sound the chime once on enable, so its volume is a known quantity before
    // it arrives unannounced during an outage.
    playAlertSound("advisory");
  }
  return granted;
}

export function sendNotification(kind: string, title: string, body: string): void {
  if (!notificationsEnabled()) return;
  const lastSentAt = lastSentAtByKind.get(kind) ?? 0;
  if (Date.now() - lastSentAt < THROTTLE_MS) return;
  lastSentAtByKind.set(kind, Date.now());
  new Notification(title, { body, tag: `dishboard-${kind}` });
}
