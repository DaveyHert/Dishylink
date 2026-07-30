// Desktop notifications for alerts, opt-in via the alerts panel.
//
// Two transports, one interface. In the desktop app the host posts them from the
// main process; in a browser tab the web Notification API does. They are kept
// behind one door because everything upstream — useDeviceAlerts, the outage
// notifications — should only have to know that a notification was requested.
//
// The split matters because permission works differently in each. A browser tab
// must ask, and the user can refuse. The desktop window loads over app://, where
// asking is not something that can succeed: a sandboxed renderer on a custom
// origin never reaches `Notification.permission === "granted"`. Treating the web
// rule as universal is what left the desktop app unable to notify and its
// "Enable notifications" control unable to ever read as on, whatever it was
// clicked.
//
// On the host the question is therefore not "were we given permission" but "did
// one actually arrive", which only the OS can answer: macOS accepts a request
// from an app it has no notification registration for and drops it silently.
// Enabling posts a real notification and believes the delivery result, so the
// control cannot read as on while nothing is reaching the user. An unsigned dev
// run is the case that always fails this — notifications land in the packaged,
// signed app, and the toggle now says so instead of pretending otherwise.

import { unlockAlertSound, playAlertSound } from "./alertSound";
import type { AlertSeverity } from "@core/alertDefinitions";

const ENABLED_STORAGE_KEY = "dishboard-notifications";
const THROTTLE_MS = 60_000;

const lastSentAtByKind = new Map<string, number>();

/** The desktop host's notification bridge, when running inside the app. Reports
 *  whether the OS delivered, and why not when it didn't — the packaged-vs-unsigned
 *  reason the main process alone can tell. */
interface NotificationHost {
  notify(title: string, body: string): Promise<{ delivered: boolean; reason?: string }>;
  /** null when the host has no stored choice yet. */
  notificationsEnabled(): Promise<boolean | null>;
  setNotificationsEnabled(enabled: boolean): Promise<boolean>;
}

// A host registered by its own entry point, for hosts that don't inject a global
// the way the desktop preload injects window.dishlink. The extension's dashboard
// registers one that bridges to its background worker — the always-on announcer
// that is its counterpart to the desktop main process.
let registeredHost: NotificationHost | null = null;

/** Declared once by a host whose own always-on process posts OS notifications and
 *  owns the notification preference — the desktop main process, or the extension's
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
 * The host's stored preference, mirrored here so the synchronous checks below
 * can answer without awaiting.
 *
 * On the desktop the preference belongs to the main process — that is where the
 * recorder decides to announce an alert, with or without a window. This window
 * only reflects it, and must load it before rendering a control that claims to
 * show its state.
 */
let hostPreference: boolean | null = null;

/**
 * Mirror the host's preference into this window, seeding it if the host has
 * none. A no-op in a browser tab, where localStorage is already the whole answer.
 *
 * The seeding is the upgrade path. This setting used to live only in
 * localStorage, so a user who had already turned notifications on has that
 * recorded here and nowhere the recorder can see it. Reading an unset host as
 * "off" would switch alerting off for precisely the people who wanted it, and
 * they would have no reason to go looking at a toggle they already set.
 */
export async function loadNotificationPreference(): Promise<void> {
  const host = notificationHost();
  if (host === null) return;
  const stored = await host.notificationsEnabled().catch(() => false);
  if (stored !== null) {
    hostPreference = stored;
    return;
  }
  const wanted = localStorage.getItem(ENABLED_STORAGE_KEY) === "on";
  hostPreference = await host.setNotificationsEnabled(wanted).catch(() => false);
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

function webNotificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

export function notificationsSupported(): boolean {
  return notificationHost() !== null || webNotificationsSupported();
}

function preferenceIsOn(): boolean {
  if (notificationHost() !== null) return hostPreference === true;
  return localStorage.getItem(ENABLED_STORAGE_KEY) === "on";
}

export function notificationsEnabled(): boolean {
  if (!preferenceIsOn()) return false;
  // On the host the preference is the whole answer: there is no renderer
  // permission to consult, and consulting one would always say no.
  if (notificationHost() !== null) return true;
  return webNotificationsSupported() && Notification.permission === "granted";
}

export interface NotificationToggleResult {
  /** Whether notifications are on once this toggle settles. */
  enabled: boolean;
  /** A line to show the user when an enable attempt was refused, so the control
   *  explains itself rather than reading as a dead click. Absent on success and
   *  on a plain turn-off. */
  blockedReason?: string;
}

/** Toggle notifications; resolves to the state, plus why if an enable failed. */
export async function toggleNotifications(): Promise<NotificationToggleResult> {
  if (!notificationsSupported()) return { enabled: false };
  if (notificationsEnabled()) {
    localStorage.setItem(ENABLED_STORAGE_KEY, "off");
    // Turning it off has to reach the recorder too, or the app keeps announcing
    // alerts from the tray after the user switched them off in the window.
    const host = notificationHost();
    if (host !== null) hostPreference = await host.setNotificationsEnabled(false).catch(() => false);
    return { enabled: false };
  }
  // Browsers only let audio start from a user gesture, and this toggle is the
  // one we get — open the context here so later alerts can actually chime.
  unlockAlertSound();

  const confirmBody = "DishyLink will alert you about Starlink outages.";
  // Sound the chime once on enable, so its volume is a known quantity before it
  // arrives unannounced during an outage.
  const enabled = (): NotificationToggleResult => {
    localStorage.setItem(ENABLED_STORAGE_KEY, "on");
    playAlertSound("advisory");
    return { enabled: true };
  };
  const refused = (blockedReason: string): NotificationToggleResult => {
    localStorage.setItem(ENABLED_STORAGE_KEY, "off");
    return { enabled: false, blockedReason };
  };
  /** Record the answer where the recorder can read it, and mirror back what it
   *  actually stored. A failed write settles to off: the recorder is what sends
   *  notifications, so a window claiming they are on while that process has them
   *  off is the one state this control must never show. */
  const persistToHost = async (host: NotificationHost, on: boolean): Promise<boolean> => {
    hostPreference = await host.setNotificationsEnabled(on).catch(() => false);
    return hostPreference;
  };

  const host = notificationHost();
  if (host !== null) {
    // The confirmation doubles as the probe: the host posts it and reports back
    // whether the OS delivered, and why not when it didn't. That reason is the
    // packaged-vs-unsigned truth only the main process holds — an unsigned dev
    // run is refused however the Settings toggle reads. Turning the control on
    // off the back of "we asked" is how it ends up saying "Notifications on"
    // while nothing ever appears.
    const result = await host
      .notify("Notifications on", confirmBody)
      .catch(() => ({ delivered: false }) as { delivered: boolean; reason?: string });
    // The stored answer, not the probe's — if the write failed, the recorder
    // still has them off, and this control has to say so.
    const stored = await persistToHost(host, result.delivered);
    return stored ? enabled() : refused(result.reason ?? "Notifications couldn’t be enabled.");
  }

  // Browser: ask, and tell a standing refusal apart from a dismissed prompt. Only
  // "denied" is blocked; a dismissed prompt is neither on nor a settings problem,
  // and calling it "blocked" points the user at a switch they never touched.
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    // The host sent its confirmation as the probe; the browser still owes one.
    sendNotification("test", "Notifications on", confirmBody);
    return enabled();
  }
  return refused(
    permission === "denied"
      ? "Notifications are blocked for this page in your browser settings."
      : "Notifications weren’t enabled.",
  );
}

export function sendNotification(kind: string, title: string, body: string): void {
  if (!notificationsEnabled()) return;
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
  new Notification(title, { body, tag: `dishboard-${kind}` });
}

/** Whether this window is the surface the user is looking at: visible and focused.
 *  The in-app chime plays only when it is — you are here to hear it — and the OS
 *  notification is left for when it is not. */
export function windowIsForeground(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
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
