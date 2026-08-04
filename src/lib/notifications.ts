// Desktop notifications for alerts, opt-in via the alerts panel.
//
// Two transports, one interface. In the desktop app the host posts them from the
// main process; in a browser tab the web Notification API does. They are kept
// behind one door because everything upstream — useDeviceAlerts, the outage
// notifications — should only have to know that a notification was requested.
//
// Where the state lives differs, and that is what shapes this file. A host with
// its own always-on process owns it: the desktop main process and the extension's
// background worker each announce alerts with no window open, so a preference
// this window kept to itself would be unreadable exactly when it mattered. This
// module holds what such a host last reported and is told when that changes; the
// controls read it synchronously and re-render on the change. A plain browser tab
// has no such process, and there this module's own reading of localStorage and
// the page's permission is the whole of it.
//
// Permission also differs, and only the tab has any. A sandboxed renderer on the
// app:// origin never reaches `Notification.permission === "granted"`, so the
// desktop app asks the OS through its host instead and learns the answer the only
// way macOS gives it: by posting one and seeing whether it arrived. The OS accepts
// a request from an app it holds no notification registration for and drops it
// silently, so an attempt is the only test. An unsigned dev run always fails it —
// notifications land in the packaged, signed app — and the reason is reported
// beside the control rather than left as a switch that appears to do nothing.

import { unlockAlertSound, playAlertSound } from "./alertSound";
import type { AlertSeverity } from "@core/alertDefinitions";
import {
  notificationsRequested,
  notificationsProblem,
  NOTIFICATIONS_ON_CONFIRMATION,
  type NotificationState,
} from "@core/alertNotification";

const ENABLED_STORAGE_KEY = "dishylink-notifications";
const THROTTLE_MS = 60_000;

const lastSentAtByKind = new Map<string, number>();

/** The always-on host's notification bridge, when running inside one. It owns the
 *  state, posts the OS notification, and reports both back — including why a post
 *  failed, which only a process talking to the OS directly can tell. */
interface NotificationHost {
  notify(title: string, body: string): Promise<{ delivered: boolean; reason?: string }>;
  notificationState(): Promise<NotificationState>;
  /** Records the request. The reply carries the state as it stands after it. */
  setNotificationsWanted(wanted: boolean): Promise<NotificationState>;
  /** Reports every later change, so this window follows the host rather than its
   *  own last write. Returns an unsubscribe. */
  onNotificationState(listener: (state: NotificationState) => void): () => void;
}

// A host registered by its own entry point, for hosts that don't inject a global
// the way the desktop preload injects window.dishlink. The extension's dashboard
// registers one that bridges to its background worker — the always-on announcer
// that is its counterpart to the desktop main process.
let registeredHost: NotificationHost | null = null;

/** Declared once by a host whose own always-on process posts OS notifications and
 *  owns the notification state — the desktop main process, or the extension's
 *  background worker via a bridge. Makes hostAnnouncesAlerts() true: a backgrounded
 *  window leaves the away-notification to that process, and a window in front
 *  sounds its own chime. */
export function setNotificationHost(host: NotificationHost): void {
  registeredHost = host;
}

function notificationHost(): NotificationHost | null {
  if (registeredHost !== null) return registeredHost;
  const host = (window as { dishlink?: Partial<NotificationHost> }).dishlink;
  return typeof host?.notify === "function" ? (host as NotificationHost) : null;
}

/**
 * Notifications as this window currently understands them, and the one thing the
 * controls render from.
 *
 * Starts as an unanswered request so nothing claims to know the setting before
 * the host has said: `wanted: null` is "not yet told", which the controls show as
 * off but replace as soon as the host reports — a first paint that corrects
 * itself, rather than a wrong answer that persists.
 */
let state: NotificationState = { wanted: null, deliverable: true };
const stateListeners = new Set<() => void>();

function setState(next: NotificationState): void {
  state = next;
  for (const listener of stateListeners) listener();
}

/** Subscribe to the notification state; returns an unsubscribe. Paired with
 *  notificationsOn and notificationsBlockedReason, which read the snapshot. */
export function subscribeToNotifications(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

function webNotificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/** The state of a plain browser tab, which keeps the request in localStorage and
 *  takes delivery straight from the page's permission — the one host where
 *  whether notifications can arrive is knowable without posting one. */
function webState(): NotificationState {
  const wanted = localStorage.getItem(ENABLED_STORAGE_KEY) === "on";
  if (!webNotificationsSupported())
    return { wanted, deliverable: false, reason: "This browser doesn’t support notifications." };
  if (Notification.permission === "granted") return { wanted, deliverable: true };
  // A standing refusal and a dismissed prompt are different problems: only the
  // first is a setting to go and change, and naming it otherwise sends the user
  // to a switch they never touched.
  return {
    wanted,
    deliverable: false,
    reason:
      Notification.permission === "denied"
        ? "Notifications are blocked for this page in your browser settings."
        : "Notifications weren’t enabled.",
  };
}

/**
 * Bind this window to wherever the notification state lives, and seed it.
 *
 * The subscription is taken before the first read so a change arriving during it
 * is not missed. On a host that has never been asked, the answer is seeded from
 * this window's localStorage: the setting is read from that key in a plain tab,
 * so someone who turned notifications on there has it recorded nowhere the
 * always-on process can see. Reading an unset host as "off" would switch alerting
 * off for precisely the people who asked for it, and leave them no reason to go
 * looking at a control they had already set.
 */
export async function bindNotifications(): Promise<void> {
  const host = notificationHost();
  if (host === null) {
    setState(webState());
    return;
  }
  host.onNotificationState(setState);
  const reported = await host.notificationState().catch(() => null);
  if (reported === null) return;
  if (reported.wanted !== null) {
    setState(reported);
    return;
  }
  const wanted = localStorage.getItem(ENABLED_STORAGE_KEY) === "on";
  setState(await host.setNotificationsWanted(wanted).catch(() => reported));
}

/**
 * Whether a host with its own always-on process — the desktop main process, or
 * the extension's background worker — is the one that posts OS notifications.
 *
 * It governs only the OS notification, and only for a backgrounded window:
 * announceAlert sounds the in-app chime itself when its window is in front, and
 * for anything behind it either leaves the toast to that process — which sees the
 * alert with or without a window, and holds it back while a window is in front —
 * or posts it here in a plain browser tab, where no such process exists.
 */
export function hostAnnouncesAlerts(): boolean {
  return notificationHost() !== null;
}

export function notificationsSupported(): boolean {
  return notificationHost() !== null || webNotificationsSupported();
}

/** Whether the control reads as on: the request, not whether the last one landed
 *  — see notificationsRequested for why those are answered separately. */
export function notificationsOn(): boolean {
  return notificationsRequested(state);
}

/** Why nothing is arriving despite being asked for, to show beside the control.
 *  Null when there is nothing to explain. */
export function notificationsBlockedReason(): string | null {
  return notificationsProblem(state);
}

/** Whether this window may post one right now. A host is always worth trying —
 *  the attempt is what reveals whether the channel works — but a tab that has not
 *  been granted permission cannot post at all. */
function canSendNotification(): boolean {
  if (!notificationsRequested(state)) return false;
  if (notificationHost() !== null) return true;
  return webNotificationsSupported() && Notification.permission === "granted";
}

/**
 * Turn notifications on or off.
 *
 * Enabling posts the confirmation, which doubles as the probe: on macOS the first
 * notification is what raises the permission prompt, and its outcome is what tells
 * the host whether the channel works. The resulting state arrives through the
 * subscription, so there is nothing to return — the controls are already reading
 * it.
 */
export async function toggleNotifications(): Promise<void> {
  if (!notificationsSupported()) return;
  const wanted = !notificationsOn();
  const host = notificationHost();
  localStorage.setItem(ENABLED_STORAGE_KEY, wanted ? "on" : "off");

  if (!wanted) {
    // Turning it off has to reach the always-on process too, or it keeps
    // announcing alerts after the user switched them off in the window.
    if (host !== null) setState(await host.setNotificationsWanted(false).catch(() => state));
    else setState(webState());
    return;
  }

  // Browsers only let audio start from a user gesture, and this toggle is the
  // one we get — open the context here so later alerts can actually chime.
  unlockAlertSound();

  if (host !== null) {
    setState(await host.setNotificationsWanted(true).catch(() => state));
    await host
      .notify(NOTIFICATIONS_ON_CONFIRMATION.title, NOTIFICATIONS_ON_CONFIRMATION.body)
      .catch(() => {});
    // Sound the chime once, so its volume is a known quantity before it arrives
    // unannounced during an outage. Skipped when the confirmation could not be
    // delivered: nothing about this channel is working, and a chime would suggest
    // otherwise.
    if (notificationsBlockedReason() === null) playAlertSound("advisory");
    return;
  }

  await Notification.requestPermission();
  setState(webState());
  if (notificationsBlockedReason() !== null) return;
  sendNotification("test", NOTIFICATIONS_ON_CONFIRMATION.title, NOTIFICATIONS_ON_CONFIRMATION.body);
  playAlertSound("advisory");
}

export function sendNotification(kind: string, title: string, body: string): void {
  if (!canSendNotification()) return;
  const lastSentAt = lastSentAtByKind.get(kind) ?? 0;
  if (Date.now() - lastSentAt < THROTTLE_MS) return;
  lastSentAtByKind.set(kind, Date.now());

  const host = notificationHost();
  if (host !== null) {
    // Fire and forget: a host that fails to post one must not take down the
    // caller, which is usually mid-render of the alert it is announcing.
    void host.notify(title, body).catch(() => {});
    return;
  }
  new Notification(title, { body, tag: `dishylink-${kind}` });
}

/** Whether this window is the surface the user is looking at: visible and focused.
 *  The in-app chime plays only when it is — you are here to hear it — and the OS
 *  notification is left for when it is not. */
export function windowIsForeground(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()
  );
}

/**
 * Announce one alert's onset or clear, routed by where the user is.
 *
 * In front of the window: the in-app chime, and nothing else — governed only by
 * the sound control, never by the notifications toggle, because the alert is
 * already on screen and the toggle is for notifications that reach past it.
 *
 * Not in front: the OS notification, which the notifications toggle governs. A
 * host with its own always-on process (desktop main, the extension worker) posts
 * that itself when its window is away, so the renderer stays out of it; only the
 * plain web tab, which has no such process, posts it here.
 */
export function announceAlert(
  severity: AlertSeverity,
  cleared: boolean,
  key: string,
  title: string,
  body: string,
): void {
  if (windowIsForeground()) {
    playAlertSound(severity, cleared, key);
    return;
  }
  if (hostAnnouncesAlerts()) return;
  sendNotification(key, title, body);
}
