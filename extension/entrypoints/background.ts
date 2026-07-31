import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { drainOnce } from "../lib/collector";
import { NotificationThrottle, describeTransition } from "@core/alertNotification";
import type { AlertTransition } from "@core/alertEngine";
import type { AlertSeverity, AlertState } from "@core/alertDefinitions";
import { routeApiRequest } from "../lib/apiRouter";
import { handleCloudRequest } from "../lib/cloudHandler";
import { IndexedDbHistory } from "../lib/history";
import { NOTIFICATIONS_ENABLED_KEY, type NotifyResult } from "../lib/notificationHost";

// The toolbar icon opens the full dashboard page, never a toolbar-anchored
// dropdown (the dashboard is chart-heavy and wants room). Two user-selectable
// surfaces: a chromeless standalone window (default) or an ordinary tab. With no
// default_popup in the manifest, action.onClicked fires and branches here.
const DASHBOARD_PATH = "/dashboard.html";
const SURFACE_KEY = "surface";
const WINDOW_BOUNDS_KEY = "dashboardWindowBounds";
const LAST_DRAIN_KEY = "lastDrain";

type Surface = "window" | "tab";
type Bounds = { top: number; left: number; width: number; height: number };

const DEFAULT_BOUNDS: Bounds = { top: 80, left: 120, width: 1320, height: 880 };

// The single open dashboard window, so a second click focuses it instead of
// opening another. Held in memory; the browser clears the worker's memory on
// teardown, but a stale id is re-validated against browser.windows before use.
let dashboardWindowId: number | undefined;

async function readSurface(): Promise<Surface> {
  const stored = await browser.storage.local.get(SURFACE_KEY);
  return stored[SURFACE_KEY] === "tab" ? "tab" : "window";
}

async function openDashboardWindow(): Promise<void> {
  if (dashboardWindowId !== undefined) {
    try {
      await browser.windows.update(dashboardWindowId, { focused: true });
      return;
    } catch {
      // The remembered window was closed; fall through and open a fresh one.
      dashboardWindowId = undefined;
    }
  }
  const stored = await browser.storage.local.get(WINDOW_BOUNDS_KEY);
  const bounds = (stored[WINDOW_BOUNDS_KEY] as Bounds | undefined) ?? DEFAULT_BOUNDS;
  const created = await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL(DASHBOARD_PATH),
    ...bounds,
  });
  dashboardWindowId = created?.id;
}

async function openDashboardTab(): Promise<void> {
  const url = browser.runtime.getURL(DASHBOARD_PATH);
  const existing = await browser.tabs.query({ url });
  if (existing[0]?.id !== undefined) {
    await browser.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId !== undefined)
      await browser.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url });
}

async function openDashboard(): Promise<void> {
  if ((await readSurface()) === "tab") await openDashboardTab();
  else await openDashboardWindow();
}

/**
 * Put an alert in front of the user, with no dashboard open.
 *
 * The drain tick is the only thing awake in the browser — the dashboard may
 * never have been opened — so this is the extension's whole alerting path, the
 * counterpart to the desktop app announcing from its main process. The wording
 * and what is worth interrupting someone for both come from core, so an alert
 * reads the same here as it does there.
 *
 * The throttle is rebuilt each wake because the service worker is torn down
 * between alarms and cannot hold one. That is weaker than it looks: it only
 * matters for an alert crossing its threshold twice inside a minute, and the
 * engine's own state — restored from IndexedDB — already stops a still-firing
 * alert being re-announced at all.
 */
async function announceAlerts(transitions: AlertTransition[]): Promise<void> {
  if (transitions.length === 0) return;
  // The one on/off switch, read where the worker can see it. Off — or never set,
  // which reads as off — means silent, matching the desktop, whose recorder
  // returns early unless the preference is an explicit yes. This is the whole
  // reason the preference lives in chrome.storage rather than the page's
  // localStorage: a service worker cannot read localStorage.
  if (!(await notificationsEnabled())) return;
  const throttle = new NotificationThrottle();
  const inFront = await dashboardIsForeground();
  for (const transition of transitions) {
    const notification = describeTransition(transition);
    if (!notification) continue;
    if (!throttle.allow(notification.key, transition.atMs)) continue;
    // Dashboard in front → it sounds its own chime (its useDeviceAlerts owns the
    // in-app alert sound, governed by the sound control alone); an OS toast over a
    // page already on screen would be noise, and the alert is visible there anyway.
    // Otherwise the toast is the only channel. A refused or unavailable toast must
    // not take the drain down — the episode is recorded, so a failure is fine.
    if (inFront) continue;
    await postNotification(notification.key, notification.title, notification.body);
  }
}

/** Whether the dashboard is the tab the user is looking at right now — its own
 *  active tab in a focused window. When it is, it owns the alert sound and the
 *  worker stays quiet; when it is not (backgrounded or closed), the worker posts
 *  the OS toast. The desktop's windowIsForeground() is the counterpart. */
async function dashboardIsForeground(): Promise<boolean> {
  const url = browser.runtime.getURL(DASHBOARD_PATH);
  const tabs = await browser.tabs.query({ url }).catch(() => []);
  for (const tab of tabs) {
    if (tab.active && tab.windowId !== undefined) {
      const win = await browser.windows.get(tab.windowId).catch(() => null);
      if (win?.focused) return true;
    }
  }
  return false;
}

async function notificationsEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(NOTIFICATIONS_ENABLED_KEY);
  return stored[NOTIFICATIONS_ENABLED_KEY] === true;
}

/** Post one OS toast. Resolves whether the browser accepted it — never whether
 *  the OS then displayed it, which chrome.notifications does not report (the same
 *  blind spot the desktop documents for macOS). A throwing create resolves to
 *  not-delivered rather than propagating. */
async function postNotification(key: string, title: string, body: string): Promise<NotifyResult> {
  try {
    await browser.notifications.create(key, {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title,
      message: body,
    });
    return { delivered: true };
  } catch (error) {
    return { delivered: false, reason: (error as Error).message };
  }
}

// The toolbar badge mirrors the app's bell: the count of alerts firing right
// now, tinted by the worst one's severity, so the same number the dashboard
// shows inside is visible without opening it — and clears the instant they do.
// The colours track the app's status palette (critical red, warning amber,
// advisory slate).
const BADGE_COLOR: Record<AlertSeverity, string> = {
  critical: "#e5484d",
  warning: "#f5a623",
  advisory: "#8b8d98",
};

// Firefox's MV2 build has no `browser.action` — only `browserAction`. WXT's
// `browser` is a plain passthrough to the native global (no MV2/MV3 API
// unification), so this codebase has to bridge it: the manifest key becomes
// `browser_action` for Firefox at build time, but the JS namespace does not.
const action = browser.action ?? browser.browserAction;

/**
 * Reflect the live alert set onto the toolbar icon — the same count the app's
 * bell shows, so it reads identically inside and out.
 *
 * Driven from `active` — the episodes still open after this tick's reconcile,
 * worst first — not from the tick's transitions. A badge set from edges would
 * blank on the next service-worker restart, which happens between every alarm;
 * the standing count has to come from the standing state. An empty set clears
 * the badge, so a cleared alert removes it with no separate step.
 *
 * Starlink outages are left out, exactly as the bell leaves them out: a healthy
 * dish drops its link to the satellites many times an hour as they hand over,
 * and a badge that counted each one would sit permanently lit over something
 * that needs no attention. Outages surface as their own thing, not as a device
 * fault to be tallied here.
 */
function badgeWorthy(alert: AlertState): boolean {
  return !(alert.source === "system" && alert.key === "starlinkOutage");
}

async function updateBadge(active: AlertState[]): Promise<void> {
  const shown = active.filter(badgeWorthy);
  await action.setBadgeText({ text: shown.length === 0 ? "" : String(shown.length) });
  if (shown.length === 0) return;
  // activeAlerts() sorts worst-first, so the head sets the tint.
  await action.setBadgeBackgroundColor({ color: BADGE_COLOR[shown[0].severity] });
  await action.setBadgeTextColor?.({ color: "#ffffff" });
}

export default defineBackground(() => {
  // A notification about the dish is only useful if it can take you to the
  // dashboard showing why, the same as clicking one on the desktop.
  browser.notifications.onClicked.addListener(() => void openDashboard());

  action.onClicked.addListener(() => void openDashboard());

  // The dashboard page reads recorded history over /api, which no origin serves
  // inside an extension, so its apiHost binding messages here. Only /api messages
  // are handled; returning a promise for them (and nothing for anything else)
  // keeps the response channel open for the async IndexedDB read.
  browser.runtime.onMessage.addListener((message) => {
    const request = message as {
      type?: string;
      path?: string;
      method?: string;
      body?: string | unknown;
      title?: string;
    };
    // The dashboard's notification bridge: it owns the on/off preference in
    // storage directly, but the toast itself has to be posted from here — the
    // worker is the only context with chrome.notifications — so a real alert and
    // the toggle's confirmation take the exact same path. One fixed key, so
    // toggling on repeatedly replaces the confirmation rather than stacking it.
    if (request.type === "notify") {
      return postNotification("notify-probe", request.title ?? "", String(request.body ?? ""));
    }
    if (typeof request?.path !== "string") return false;
    // Account calls reach starlink.com over the internet, held apart from the
    // recorded-history reads that answer from IndexedDB.
    if (request.type === "cloud") {
      return handleCloudRequest({
        path: request.path,
        method: request.method,
        body: request.body,
      });
    }
    if (request.type !== "api") return false;
    return IndexedDbHistory.open().then((store) =>
      routeApiRequest(store, request.path!, new Date(), request.method ?? "GET", request.body as string | undefined),
    );
  });

  // Saved bounds are restored on the next open, so the window returns where the
  // user left it. Only the dashboard window's own moves and resizes are tracked.
  const rememberBounds = (windowId: number) => {
    if (windowId !== dashboardWindowId) return;
    void browser.windows.get(windowId).then((win) => {
      if (win.top == null || win.left == null || win.width == null || win.height == null) return;
      void browser.storage.local.set({
        [WINDOW_BOUNDS_KEY]: { top: win.top, left: win.left, width: win.width, height: win.height },
      });
    });
  };
  browser.windows.onBoundsChanged?.addListener((win) => {
    if (win.id !== undefined) rememberBounds(win.id);
  });
  browser.windows.onRemoved.addListener((windowId) => {
    if (windowId === dashboardWindowId) dashboardWindowId = undefined;
  });

  // The drain runs off a chrome.alarms tick so it survives service-worker
  // teardown — the alarm re-wakes the worker, which reads the persisted cursor
  // and drains only what the dish has added since. The last tick's outcome is
  // stored so the dashboard can show whether collection is currently reaching the
  // dish, and the tick is also what notices an alert worth announcing.
  const runDrain = async () => {
    const { status, alerts, active } = await drainOnce();
    await browser.storage.local.set({ [LAST_DRAIN_KEY]: status });
    await updateBadge(active);
    await announceAlerts(alerts);
  };
  // 0.5 is Chrome's floor for a packed extension — the store build cannot tick
  // faster however this is set, and asking for less only logs a warning. Half a
  // minute, because the alarm is what makes an alert reach anyone: nothing else
  // in the browser is awake to notice.
  browser.alarms.create("drain", { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "drain") void runDrain();
  });
  // A worker that just started (install, browser launch, or wake) drains at once
  // rather than idling until the first alarm a minute later.
  void runDrain();
});
