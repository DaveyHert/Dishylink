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

const ENABLED_STORAGE_KEY = "dishboard-notifications";
const THROTTLE_MS = 60_000;

const lastSentAtByKind = new Map<string, number>();

/** The desktop host's notification bridge, when running inside the app. Reports
 *  whether the OS delivered, and why not when it didn't — the packaged-vs-unsigned
 *  reason the main process alone can tell. */
interface NotificationHost {
  notify(title: string, body: string): Promise<{ delivered: boolean; reason?: string }>;
}

function notificationHost(): NotificationHost | null {
  const host = (window as { dishlink?: Partial<NotificationHost> }).dishlink;
  return typeof host?.notify === "function" ? (host as NotificationHost) : null;
}

function webNotificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

export function notificationsSupported(): boolean {
  return notificationHost() !== null || webNotificationsSupported();
}

function preferenceIsOn(): boolean {
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
    return result.delivered
      ? enabled()
      : refused(result.reason ?? "Notifications couldn’t be enabled.");
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
