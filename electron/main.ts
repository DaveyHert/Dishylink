// The Electron main process — the app's one privileged host. It owns the window,
// the tray, and the collector (the historian, run in-process). The renderer is
// sandboxed and reaches this side only through the preload bridge: there is no
// localhost port, so nothing on the machine but this app can reach the dish data
// or cloud session.
//
// Lifecycle: the app is a background recorder with a window, not a window with a
// background job. Closing the window releases the renderer but leaves the collector
// running in the tray; the app quits only when the user chooses Quit.

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  shell,
  type MenuItem,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { registerAppProtocolScheme, handleAppProtocol, APP_ENTRY_URL } from "./appProtocol";
import { startCollector, handleApiRequest, onAlertTransitions } from "./collector";
import { startCloud, handleCloudRequest, signIn } from "./cloud";
import { preferences, setPreference, onPreferencesChanged } from "./preferences";
import {
  describeTransition,
  NotificationThrottle,
  notificationsRequested,
  notificationsProblem,
  NOTIFICATIONS_ON_CONFIRMATION,
  type NotificationState,
} from "../core/alertNotification";
import { NOTIFICATION_STATE_CHANNEL } from "./ipc";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "../dist");
const iconPath = join(here, "../build/icon.png");

// Name the app before anything reads it — it drives the menu-bar title and the
// per-app data directory. The macOS dock-hover tooltip comes from the bundle
// itself, so it only reflects this once the app is packaged.
app.setName("DishyLink");

// Declaring the app:// scheme must happen before the app is ready, so it runs at
// module load rather than inside whenReady.
registerAppProtocolScheme();

// vite-plugin-electron sets this while `vite` is serving; it is absent in a
// packaged build, where the renderer is loaded over app:// instead.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const NOTIFY_ITEM_ID = "notify-alerts";
const NOTIFY_REASON_ITEM_ID = "notify-alerts-reason";

/** The tray's notification items, updated in place as the state changes. */
let notifyItem: MenuItem | null = null;
let notifyReasonItem: MenuItem | null = null;

/**
 * Why the last notification failed to reach the user, or null while they are
 * arriving.
 *
 * Learned by posting, because on macOS that is the only thing that answers:
 * the OS accepts a request from an app it has no registration for and drops it
 * silently, so nothing short of an attempt distinguishes a working channel from
 * a mute one. Every attempt updates this — the recorder's alerts as much as a
 * confirmation — so it reflects the channel as last observed rather than as
 * last asked about.
 *
 * Starts null: nothing has failed yet, and starting from "broken" would hide a
 * working channel behind a warning until something happened to clear it.
 */
let notificationFailureReason: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 980,
    // Below this the dashboard's tiles and charts stop being usable; the app's
    // responsive layout still adapts down to it.
    minWidth: 800,
    minHeight: 700,
    // The desktop window keeps this fixed title; the shared page <title> is the
    // neutral "Starlink Companion (Unofficial)" that the browser and extension use.
    title: "DishyLink — Starlink Companion Desktop App (Unofficial)",
    // Drop the macOS title-bar band so the app's own background reaches the top
    // edge; the traffic lights stay, inset, floating over it. The renderer reserves
    // room for them and makes the top bar draggable (see the data-host rules).
    titleBarStyle: "hiddenInset",
    // Paint nothing until the app has rendered, so there is no white flash.
    show: false,
    webPreferences: {
      preload: join(here, "preload.mjs"),
      // The renderer runs untrusted web code and must not touch Node or Electron
      // internals directly; the preload bridge is the only crossing.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Let the alert chime start without a prior click. A login launch can open
      // this window focused but untouched; with the default policy its
      // AudioContext stays suspended until a gesture, so an alert arriving first
      // would be silent — and since main routes an in-front alert to this chime
      // rather than an OS banner, nothing at all would sound.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // Keep the fixed window title above; without this the page's <title> replaces it.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  // A window opens knowing nothing about the notification state, and asking for it
  // costs a round trip its first render cannot wait for. Pushing it as the page
  // finishes loading means the control's first paint is either already right or
  // corrected in the same beat, without holding up the paint to find out.
  mainWindow.webContents.on("did-finish-load", publishNotificationState);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Closing the window frees the renderer; the collector keeps running in the tray.
  // Reopening builds a fresh window.
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(devServerUrl ?? APP_ENTRY_URL);
}

/** Bring the window forward, building it if the last one was closed. */
function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/** Whether the window is the surface the user is actually looking at right now.
 *  A minimized window still "has focus" but shows no banner, so it counts as away
 *  — an alert then belongs on the OS notification, not the in-window chime. */
function windowIsForeground(): boolean {
  return mainWindow !== null && mainWindow.isFocused() && !mainWindow.isMinimized();
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 18, height: 18 }));
  tray.setToolTip("DishyLink");
  const menu = Menu.buildFromTemplate([
    { label: "Open DishyLink", click: showWindow },
    { type: "separator" },
    {
      // Alerting is what the app does when nobody is looking at it, so it has to
      // be switchable from the only surface that exists when nobody is: this
      // menu. Requiring someone to open a window to control the thing that runs
      // without one is the inversion this whole path exists to avoid.
      id: NOTIFY_ITEM_ID,
      label: "Notify Me About Alerts",
      type: "checkbox",
      // The opening value only. A checkbox item keeps its own `checked` from here
      // on, toggling itself on each click, so every later value is written by
      // publishNotificationState rather than read back from the preference.
      checked: notificationsRequested(notificationState()),
      click: (item) => {
        // Only the request is recorded — the same field, with the same meaning,
        // as the window's own control writes. What the post below discovers about
        // the channel shows up in the line underneath, never in this tick.
        setPreference("notifications", item.checked);
        // Enabling posts one immediately: on macOS the first notification is
        // what raises the permission prompt, and it doubles as proof the channel
        // works rather than leaving a tick box that may be announcing nothing.
        if (item.checked)
          void postNotification(
            NOTIFICATIONS_ON_CONFIRMATION.title,
            NOTIFICATIONS_ON_CONFIRMATION.body,
          ).catch(() => {});
      },
    },
    {
      // Why the tick above refused to stay on, in the menu that offered it — the
      // same sentence the alerts panel shows, so neither surface leaves a dead
      // click unexplained. Hidden while notifications are arriving normally.
      id: NOTIFY_REASON_ITEM_ID,
      label: "",
      enabled: false,
      visible: false,
    },
    {
      // A login launch stays in the tray with no window (openAsHidden, plus the
      // wasOpenedAtLogin check below), so booting the machine starts background
      // collection with no window shown.
      label: "Start at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: "separator" },
    { label: "Quit DishyLink", role: "quit" },
  ]);
  // Held so the notification items can be updated in place. Rebuilding the menu
  // to refresh a checkmark would drop the popped-up instance the user may be
  // looking at; these two are the only items whose state changes after build.
  notifyItem = menu.getMenuItemById(NOTIFY_ITEM_ID);
  notifyReasonItem = menu.getMenuItemById(NOTIFY_REASON_ITEM_ID);
  // Left click opens the app; right click shows the menu. Attaching the menu with
  // setContextMenu would make a left click open the menu too (macOS), so it is
  // popped up on right click instead.
  tray.on("click", showWindow);
  tray.on("right-click", () => tray?.popUpContextMenu(menu));
}

/**
 * On the first packaged run, start the app with the machine — a background recorder
 * that only runs when the app is open would miss exactly the outages a user cares
 * about. The tray's "Open at Login" controls it from then on.
 *
 * A dev run is never packaged; it must not leave a login item pointing at
 * node_modules/electron, so there it only clears any such entry.
 */
function configureLoginItem(): void {
  if (!app.isPackaged) {
    // macOS refuses login-item changes for a non-bundled app, so only attempt the
    // clear when there is actually an entry to remove.
    if (app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  const marker = join(app.getPath("userData"), ".setup-done");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {
    // Non-fatal: it just means we re-offer the default next launch.
  }
}

/**
 * The account session: the sign-in window, and the renderer's /cloud/* calls
 * carried over IPC rather than over its own origin.
 *
 * A packaged window loads over app:// and could fetch those routes directly, but
 * a dev-server window cannot — Vite's origin has its own binding, with its own
 * session file. Handing both windows to the same handler gives the desktop app
 * one account session however it was launched. The payload stays plain JSON so
 * the browser extension can reuse the shape over chrome.runtime messaging.
 */
function registerCloudHandlers(): void {
  ipcMain.handle("starlink-signin", (event) =>
    signIn(BrowserWindow.fromWebContents(event.sender) ?? undefined),
  );
  ipcMain.handle(
    "cloud-request",
    async (
      _event,
      { path, method = "GET", body }: { path: string; method?: string; body?: unknown },
    ) => {
      // This bridge exists for the cloud routes alone; it must not become a way
      // for the renderer to reach anything else the main process can answer.
      if (!path.startsWith("/cloud/")) return { status: 404, body: { error: "not_found" } };
      // handleCloudRequest routes on the pathname alone, so the origin here only
      // makes the URL absolute. Nothing dials it.
      const request = new Request(new URL(path, "http://desktop.invalid").toString(), {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const response = await handleCloudRequest(request);
      return { status: response.status, body: await response.json() };
    },
  );
}

/**
 * Desktop notifications, posted from here rather than from the renderer.
 *
 * The window loads over app://, and a sandboxed renderer on a custom origin
 * cannot get web notification permission granted — which left the app unable to
 * notify at all, and its "Enable notifications" control unable to ever report
 * itself on. Main talks to the OS directly, so there is no web permission in the
 * way; macOS asks once for DishyLink itself, as it does for any native app.
 *
 * Clicking one raises the window: a notification about the dish is only useful
 * if it can take you to the dashboard showing why.
 */
/**
 * Why the OS would not post, phrased for the person who clicked enable. A
 * packaged, signed app that is refused has simply been switched off in System
 * Settings. An unsigned dev run is refused whatever that switch says, because
 * macOS will not post for a binary it cannot verify — the "Electron" entry reads
 * as allowed and the notification still fails. Naming the real cause keeps the
 * toggle from sending someone to a switch that is already on.
 */
function undeliverableReason(): string {
  return app.isPackaged
    ? "macOS isn’t delivering notifications — allow DishyLink under System Settings ▸ Notifications."
    : "Native notifications need the installed DishyLink app; a dev run can’t post them.";
}

/** Where notifications stand: the stored request, plus the channel as last
 *  observed. The one answer every surface renders, so none of them keeps its own. */
function notificationState(): NotificationState {
  const wanted = preferences().notifications;
  return notificationFailureReason === null
    ? { wanted, deliverable: true }
    : { wanted, deliverable: false, reason: notificationFailureReason };
}

/**
 * Write the current state to every surface that shows it: the tray items here,
 * and the window's control over the bridge.
 *
 * The single writer, called on every change — a preference write, or an attempt
 * that told us something new about the channel. Neither surface reads the state
 * for itself, so neither can be showing a different answer than the other.
 */
function publishNotificationState(): void {
  const state = notificationState();
  if (notifyItem !== null) notifyItem.checked = notificationsRequested(state);
  if (notifyReasonItem !== null) {
    const problem = notificationsProblem(state);
    notifyReasonItem.visible = problem !== null;
    notifyReasonItem.label = problem ?? "";
  }
  mainWindow?.webContents.send(NOTIFICATION_STATE_CHANNEL, state);
}

/** Record what an attempt proved about the channel, and show it if that changed. */
function recordDelivery(delivered: boolean): void {
  const reason = delivered ? null : undeliverableReason();
  if (reason === notificationFailureReason) return;
  notificationFailureReason = reason;
  publishNotificationState();
}

/**
 * Post one notification and report whether the OS took it.
 *
 * No custom sound is attached: macOS will not play an app-bundled sound file
 * through a notification (only its own system sounds), so a name here is ignored
 * and the default plays regardless. The default is what rides here, governed — as
 * it should be — by the per-app Notifications and Focus settings. The distinctive
 * per-severity chime is the renderer's job (see useDeviceAlerts), and only while
 * the window is in front; this posts nothing in that case.
 */
function postNotification(
  title: string,
  body: string,
): Promise<{ delivered: boolean; reason?: string }> {
  if (!Notification.isSupported()) {
    recordDelivery(false);
    return Promise.resolve({ delivered: false, reason: undeliverableReason() });
  }
  const notification = new Notification({ title, body });
  notification.on("click", showWindow);
  // Whether it actually reached the user, not merely that we asked — and why
  // not when it didn't, since only here is the packaged-vs-unsigned distinction
  // known. Every attempt reports back, so the channel's state is refreshed by
  // ordinary alerts and not only by someone pressing a toggle.
  return new Promise((resolve) => {
    let settled = false;
    const settle = (delivered: boolean) => {
      if (settled) return;
      settled = true;
      recordDelivery(delivered);
      resolve(
        delivered ? { delivered: true } : { delivered: false, reason: undeliverableReason() },
      );
    };
    notification.on("show", () => settle(true));
    notification.on("failed", () => settle(false));
    notification.show();
    // Not every platform emits `show`; assume success rather than disable a
    // working channel over a missing event.
    setTimeout(() => settle(true), 1_500);
  });
}

/**
 * Announce what the recorder finds, with or without a window.
 *
 * This is the whole reason the app runs a recorder rather than a dashboard: the
 * dish going offline at 3am is exactly the event nobody is watching for. This
 * must not be owned by the renderer — the recorder detects and records alerts
 * regardless of a window, so ownership anywhere else would leave them silently
 * undelivered.
 *
 * The sound follows where the user is. With the window in front, the renderer
 * sounds its own chime (see the alert effect in useDeviceAlerts) — governed by the
 * app's sound control, not this notifications preference — so this process posts
 * nothing, and an OS banner never lands over an app already on screen.
 * Backgrounded or closed, this posts the OS notification, its sound left to the
 * per-app Notifications and Focus settings where it belongs.
 */
function startAlertNotifications(): void {
  const throttle = new NotificationThrottle();
  onAlertTransitions((transitions) => {
    // Only an explicit yes. An unseeded preference is unknown, not consent.
    if (preferences().notifications !== true) return;
    for (const transition of transitions) {
      const notification = describeTransition(transition);
      if (!notification) continue;
      // Stamped from the reading, so a flapping link is rate-limited by when the
      // device said so rather than by when this loop got round to it.
      if (!throttle.allow(notification.key, transition.atMs)) continue;
      // In front of the user → the window sounds its own chime; its renderer owns
      // the in-app alert sound, governed by the sound control alone. The OS
      // notification is only for when the window is away.
      if (windowIsForeground()) continue;
      void postNotification(notification.title, notification.body).catch(() => {});
    }
  });
}

// Restricted to http(s) so a compromised renderer can't hand this an
// exotic scheme (file:, or a custom protocol another app registered) and
// have main open it with the OS's full privileges.
function registerExternalLinkHandler(): void {
  ipcMain.on("open-external", (_event, url: string) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
  });
}

function registerNotificationHandler(): void {
  ipcMain.handle("notify", (_event, { title, body }: { title: string; body: string }) =>
    postNotification(title, body),
  );
  // The state lives here because the recorder in this process is what acts on it:
  // it announces an alert with no window open. The window's control sets the
  // request and displays what comes back, and owns neither.
  ipcMain.handle("get-notification-state", () => notificationState());
  ipcMain.handle("set-notifications-wanted", (_event, wanted: boolean) => {
    setPreference("notifications", wanted === true);
    return notificationState();
  });
  // Both surfaces follow the preference from one place. A write from either of
  // them arrives here.
  onPreferencesChanged(publishNotificationState);
}

void app.whenReady().then(async () => {
  // An unpackaged run shows Electron's default icon; set ours on the macOS dock.
  // A packaged build carries the icon in its bundle, so this only applies in dev.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  // The cloud account is a property of this host, not of packaging: the session
  // belongs in the keychain and the sign-in window is ours to open, in a dev run
  // exactly as in a packaged one. It is bound before the window loads so the
  // renderer's first /cloud/* call has somewhere to land.
  startCloud();
  registerCloudHandlers();
  // Only the packaged app serves itself: the collector runs in this process and
  // app:// answers /api. In dev the Vite server proxies /api to the dev historian,
  // so starting a second collector here would just double-poll the dish.
  if (!devServerUrl) {
    await startCollector(rendererRoot);
    handleAppProtocol(rendererRoot, handleApiRequest, handleCloudRequest);
    configureLoginItem();
    // Bound to the recorder that was just started, so alerting begins with the
    // app rather than with a window. A login launch opens no window at all.
    startAlertNotifications();
  }
  // Registered for dev and packaged runs alike: notifications are the app's
  // alerting channel, not a packaging feature.
  registerNotificationHandler();
  registerExternalLinkHandler();
  createTray();
  // A normal launch opens the window; a launch the login item triggered stays in
  // the background (tray only), so booting the machine doesn't pop a window.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createWindow();
});

// The app lives in the tray after its window closes, so background collection keeps
// running — it quits only via the tray's Quit. Hence no quit on window-all-closed.
app.on("window-all-closed", () => {});

app.on("activate", showWindow);
