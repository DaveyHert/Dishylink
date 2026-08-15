// The Electron main process: the app's one privileged host — window, tray, and the
// in-process collector. The sandboxed renderer reaches it only through the preload
// bridge (no localhost port). The app is a background recorder that keeps running in
// the tray after its window closes, quitting only via the tray's Quit.

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  screen,
  shell,
  type MenuItem,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { registerAppProtocolScheme, handleAppProtocol, APP_ENTRY_URL } from "./appProtocol";
import {
  startCollector,
  handleApiRequest,
  onAlertTransitions,
  onThroughput,
  setLiveThroughputEnabled,
  type ThroughputSample,
} from "./collector";
import { startCloud, handleCloudRequest, signIn } from "./cloud";
import { localNetworkIdentity } from "../core/hostNetworkIdentity";
import { preferences, setPreference, onPreferencesChanged, type WindowBounds } from "./preferences";
import {
  describeTransition,
  NotificationThrottle,
  notificationsRequested,
  notificationsProblem,
  NOTIFICATIONS_ON_CONFIRMATION,
  type NotificationState,
} from "../core/alertNotification";
import {
  NOTIFICATION_STATE_CHANNEL,
  MENUBAR_THROUGHPUT_CHANNEL,
  UPDATE_STATE_CHANNEL,
} from "./ipc";
import { formatMenuBarRate, formatSpacedRate } from "./menuBarThroughput";
import {
  showThroughputWidget,
  paintThroughputWidget,
  hideThroughputWidget,
} from "./throughputWidget";
import { startUpdateChecks, updateState, onUpdateStateChanged } from "./updater";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "../dist");
const iconPath = join(here, "../build/icon.png");

// Drives the menu-bar title and per-app data directory; must be set before anything
// reads it.
app.setName("Dishylink");

// Must run before the app is ready, so it's at module load rather than in whenReady.
registerAppProtocolScheme();

// Set by vite-plugin-electron while serving; absent in a packaged build.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const NOTIFY_ITEM_ID = "notify-alerts";
const NOTIFY_REASON_ITEM_ID = "notify-alerts-reason";
const THROUGHPUT_ITEM_ID = "menubar-throughput";

// Tray items updated in place after build (rebuilding would drop an open popup).
let notifyItem: MenuItem | null = null;
let notifyReasonItem: MenuItem | null = null;
let throughputItem: MenuItem | null = null;

// The live throughput readout: the macOS tray title, or the Windows floating widget
// (throughputWidget.ts) — one preference, two paint targets, nothing on Linux.
// Registered in dev too, but the window-closed feed is dark there since its
// recorder runs only in the packaged app.
const MENU_BAR_THROUGHPUT_SUPPORTED = process.platform === "darwin" || process.platform === "win32";
const THROUGHPUT_TICK_MS = 1_000;
// Older than this, the feed is dead and the readout falls back to 0. Kept above
// RENDERER_REPORT_STALE_MS so a window-close handoff doesn't flash zero.
const THROUGHPUT_STALE_MS = 6_000;
// A digit's width, and unlike a normal space macOS won't trim it from a title edge.
const FIGURE_SPACE = " ";
// The readout is right-aligned in this fixed width, so the icon holds and the numbers
// swing in the gap before them. Fits "↓300.0Mb/s ↑300.0Mb/s" plus a gap from the icon.
const THROUGHPUT_TITLE_WIDTH = 18;
// A window quiet longer than this counts as not reporting, so the recorder takes over.
// Not just "window exists": a minimized one has its timers throttled.
const RENDERER_REPORT_STALE_MS = 4_000;

let latestThroughput: ThroughputSample | null = null;
// When the renderer last reported, so the watchdog can tell a reporting window from a
// quiet one (minimized, occluded, or closed) and hand the poll to the recorder.
let lastRendererReportMs = 0;
let throughputStaleTimer: ReturnType<typeof setInterval> | null = null;

// Why the last notification failed, or null while they're arriving. Learned by
// posting: macOS drops a request from an unregistered app silently, so only an attempt
// tells a working channel from a mute one.
let notificationFailureReason: string | null = null;

// A saved position from a display that's no longer connected (unplugged monitor)
// would open the window off-screen; only reuse it when its center still lands on
// some currently attached display.
function boundsOnConnectedDisplay(bounds: WindowBounds): boolean {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return screen.getAllDisplays().some(({ bounds: display }) => {
    return (
      center.x >= display.x &&
      center.x < display.x + display.width &&
      center.y >= display.y &&
      center.y < display.y + display.height
    );
  });
}

// Debounced so a drag or resize-in-progress doesn't write the settings file on every
// intermediate frame; only the position it settles on is worth persisting.
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

// getBounds() on a maximized or fullscreen window returns the full-screen rect, not
// the size the user actually chose — persisting that would make the next launch open
// at that screen-filling size, un-maximized, and stay stuck there since every save
// after would just re-persist it.
function saveBounds(): void {
  if (mainWindow === null || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  setPreference("windowBounds", mainWindow.getBounds());
}

function scheduleBoundsSave(): void {
  if (saveBoundsTimer !== null) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    saveBoundsTimer = null;
    saveBounds();
  }, 500);
}

function createWindow(): void {
  const savedBounds = preferences().windowBounds;
  const restoredBounds = savedBounds !== null && boundsOnConnectedDisplay(savedBounds);

  mainWindow = new BrowserWindow({
    width: restoredBounds ? savedBounds.width : 1500,
    height: restoredBounds ? savedBounds.height : 980,
    ...(restoredBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 800,
    minHeight: 700,
    title: "Dishylink — Starlink Companion Desktop App (Unofficial)",
    titleBarStyle: "hiddenInset",
    show: false,
    // Matches index.css's dark --page. Electron's own default is white, which the
    // native close animation exposes as a flash — it composites over this color,
    // not the last-painted frame. The app defaults to dark theme (App.tsx), so
    // this is right for the common case; a user on light theme would see the
    // flash inverted, unaddressed here.
    backgroundColor: "#000000",
    webPreferences: {
      preload: join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // Keep the fixed window title; without this the page's <title> replaces it.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  // Push notification and update state as the page loads, so both controls' first
  // paint is right.
  mainWindow.webContents.on("did-finish-load", () => {
    publishNotificationState();
    publishUpdateState();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("move", scheduleBoundsSave);
  mainWindow.on("resize", scheduleBoundsSave);
  // Bounds are captured here, not in "closed": by then the window is destroyed and
  // getBounds() is no longer available. Catches whatever the debounce above hasn't
  // flushed yet.
  mainWindow.on("close", () => {
    if (saveBoundsTimer !== null) clearTimeout(saveBoundsTimer);
    saveBounds();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    lastRendererReportMs = 0;
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

// A minimized window still "has focus" but shows no banner, so it counts as away.
function windowIsForeground(): boolean {
  return mainWindow !== null && mainWindow.isFocused() && !mainWindow.isMinimized();
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 18, height: 18 }));
  tray.setToolTip("Dishylink");
  const menu = Menu.buildFromTemplate([
    { label: "Open Dishylink", click: showWindow },
    { type: "separator" },
    {
      // Alerting runs when no window is open, so it must be switchable from the tray.
      id: NOTIFY_ITEM_ID,
      label: "Notify Me About Alerts",
      type: "checkbox",
      // Opening value only; the checkbox owns its `checked` after this, and later
      // values are written by publishNotificationState.
      checked: notificationsRequested(notificationState()),
      click: (item) => {
        setPreference("notifications", item.checked);
        // Enabling posts one immediately: on macOS the first notification raises the
        // permission prompt and proves the channel works.
        if (item.checked)
          void postNotification(
            NOTIFICATIONS_ON_CONFIRMATION.title,
            NOTIFICATIONS_ON_CONFIRMATION.body,
          ).catch(() => {});
      },
    },
    {
      // Why the tick above refused to stay on. Hidden while notifications work.
      id: NOTIFY_REASON_ITEM_ID,
      label: "",
      enabled: false,
      visible: false,
    },
    // macOS and Windows only: the surface it drives (tray title / floating widget)
    // has no equivalent on Linux. The label names that surface per platform.
    ...(MENU_BAR_THROUGHPUT_SUPPORTED
      ? [
          {
            id: THROUGHPUT_ITEM_ID,
            label:
              process.platform === "darwin"
                ? "Show Throughput in Menu Bar"
                : "Show Throughput in Taskbar",
            type: "checkbox" as const,
            checked: preferences().menuBarThroughput,
            click: (item: MenuItem) => setPreference("menuBarThroughput", item.checked),
          },
        ]
      : []),
    {
      // openAsHidden + the wasOpenedAtLogin check below start collection with no window.
      label: "Start at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: "separator" },
    { label: "Quit Dishylink", role: "quit" },
  ]);
  notifyItem = menu.getMenuItemById(NOTIFY_ITEM_ID);
  notifyReasonItem = menu.getMenuItemById(NOTIFY_REASON_ITEM_ID);
  throughputItem = menu.getMenuItemById(THROUGHPUT_ITEM_ID);
  applyMenuBarThroughput();
  updateThroughputWatchdog();
  // Left click opens the app; right click shows the menu (setContextMenu would make a
  // left click open the menu too on macOS).
  tray.on("click", showWindow);
  tray.on("right-click", () => tray?.popUpContextMenu(menu));
}

/** "↓39Kb/s ↑159Kb/s", right-aligned in a fixed-width block so the icon holds while
 *  the numbers swing in the leading gap (see THROUGHPUT_TITLE_WIDTH). */
function throughputTitle(downBps: number, upBps: number): string {
  const readout = `↓${formatMenuBarRate(downBps)} ↑${formatMenuBarRate(upBps)}`;
  return readout.padStart(THROUGHPUT_TITLE_WIDTH, FIGURE_SPACE);
}

/** Paint the readout from the latest throughput, or clear it when off. A stale
 *  sample (dish unreachable) reads as 0, not a frozen value. macOS writes the tray
 *  title; Windows drives the floating widget. */
function applyMenuBarThroughput(): void {
  if (!MENU_BAR_THROUGHPUT_SUPPORTED || tray === null) return;
  const on = preferences().menuBarThroughput;
  if (throughputItem !== null) throughputItem.checked = on;
  if (!on) {
    if (process.platform === "darwin") tray.setTitle("");
    else hideThroughputWidget();
    return;
  }
  const sample = latestThroughput;
  const fresh = sample !== null && Date.now() - sample.atMs < THROUGHPUT_STALE_MS;
  const downBps = fresh ? sample.downBps : 0;
  const upBps = fresh ? sample.upBps : 0;
  if (process.platform === "darwin") {
    tray.setTitle(throughputTitle(downBps, upBps), { fontType: "monospaced" });
  } else {
    // The widget has room for the spaced unit; the menu-bar title packs it out.
    showThroughputWidget();
    paintThroughputWidget(formatSpacedRate(downBps), formatSpacedRate(upBps));
  }
}

/** Each beat: let the recorder poll the dish only when no window is reporting (start/
 *  stop, never fetch-then-discard, so the dish is never polled twice a second), then
 *  repaint — which ages a silent feed out to zero. */
function throughputTick(): void {
  const windowReporting = Date.now() - lastRendererReportMs < RENDERER_REPORT_STALE_MS;
  setLiveThroughputEnabled(!windowReporting);
  applyMenuBarThroughput();
}

/** Run the watchdog only while the readout is on; switching it off stops the poll too. */
function updateThroughputWatchdog(): void {
  const shouldRun = MENU_BAR_THROUGHPUT_SUPPORTED && preferences().menuBarThroughput;
  if (shouldRun && throughputStaleTimer === null) {
    throughputStaleTimer = setInterval(throughputTick, THROUGHPUT_TICK_MS);
  } else if (!shouldRun && throughputStaleTimer !== null) {
    clearInterval(throughputStaleTimer);
    throughputStaleTimer = null;
    setLiveThroughputEnabled(false);
  }
}

/** Paint the recorder's reading while it's the one polling — i.e. no window is
 *  reporting its own fresher feed. The staleness guard drops a straggler that lands as
 *  a window comes back. A no-op until the collector runs (packaged app). */
function startMenuBarThroughput(): void {
  if (!MENU_BAR_THROUGHPUT_SUPPORTED) return;
  onThroughput((sample) => {
    if (Date.now() - lastRendererReportMs < RENDERER_REPORT_STALE_MS) return;
    latestThroughput = sample;
    applyMenuBarThroughput();
  });
}

/** On the first packaged run, start with the machine — a recorder that only runs while
 *  the app is open would miss the outages that matter. A dev run must not leave a login
 *  item pointing at node_modules/electron, so there it only clears one. */
function configureLoginItem(): void {
  if (!app.isPackaged) {
    // macOS refuses login-item changes for a non-bundled app; only clear if present.
    if (app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  const marker = join(app.getPath("userData"), ".setup-done");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {
    // Non-fatal: we just re-offer the default next launch.
  }
}

/** The account session: sign-in window, and the renderer's /cloud/* calls carried over
 *  IPC. A dev-server window can't fetch app:// routes directly; routing both through
 *  one handler gives the desktop app one session however it launched. */
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
      // This bridge is for the cloud routes alone; it must not reach anything else.
      if (!path.startsWith("/cloud/")) return { status: 404, body: { error: "not_found" } };
      // Routed on pathname alone; the origin only makes the URL absolute. Nothing dials it.
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

/** Why the OS won't post, phrased for the person who clicked enable. An unsigned dev
 *  run is refused whatever the System Settings switch says, since macOS won't post for
 *  a binary it can't verify. */
function undeliverableReason(): string {
  return app.isPackaged
    ? "macOS isn’t delivering notifications — allow Dishylink under System Settings ▸ Notifications."
    : "Native notifications need the installed Dishylink app; a dev run can’t post them.";
}

/** The one notification answer every surface renders: stored request + channel as last
 *  observed. */
function notificationState(): NotificationState {
  const wanted = preferences().notifications;
  return notificationFailureReason === null
    ? { wanted, deliverable: true }
    : { wanted, deliverable: false, reason: notificationFailureReason };
}

/** Single writer of the notification state to every surface (tray items + the window's
 *  control), so none of them can disagree. */
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

/** Single writer of the update state to the window. */
function publishUpdateState(): void {
  mainWindow?.webContents.send(UPDATE_STATE_CHANNEL, updateState());
}

function registerUpdateHandler(): void {
  ipcMain.handle("get-update-state", () => updateState());
  onUpdateStateChanged(publishUpdateState);
}

/** Record what an attempt proved about the channel, and show it if that changed. */
function recordDelivery(delivered: boolean): void {
  const reason = delivered ? null : undeliverableReason();
  if (reason === notificationFailureReason) return;
  notificationFailureReason = reason;
  publishNotificationState();
}

/** Post one notification and report whether the OS took it. No custom sound: macOS
 *  ignores app-bundled sounds and plays its default, governed by the per-app settings.
 *  The per-severity chime is the renderer's job, window-in-front only. */
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
  // Report whether it actually reached the user, so the channel state is refreshed by
  // ordinary alerts and not only by a toggle.
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
    // Not every platform emits `show`; assume success over a missing event.
    setTimeout(() => settle(true), 1_500);
  });
}

/** Announce what the recorder finds, with or without a window — the whole reason the
 *  app runs a recorder. With the window in front the renderer sounds its own chime and
 *  this posts nothing; backgrounded or closed, this posts the OS notification. */
function startAlertNotifications(): void {
  const throttle = new NotificationThrottle();
  onAlertTransitions((transitions) => {
    // Only an explicit yes; an unseeded preference is unknown, not consent.
    if (preferences().notifications !== true) return;
    for (const transition of transitions) {
      const notification = describeTransition(transition);
      if (!notification) continue;
      // Stamped from the reading, so a flapping link is rate-limited by device time.
      if (!throttle.allow(notification.key, transition.atMs)) continue;
      // In front of the user → the window sounds its own chime; skip the OS banner.
      if (windowIsForeground()) continue;
      void postNotification(notification.title, notification.body).catch(() => {});
    }
  });
}

// Restricted to http(s)/mailto so a compromised renderer can't hand main an exotic
// scheme (file:, a custom protocol) and have it opened with the OS's privileges.
/** Facts about this host that only main can answer. */
function registerHostHandlers(): void {
  // get_clients answers everyone identically, so "this device" can only be settled
  // from the host's own interfaces.
  ipcMain.handle("get-self-identity", () => localNetworkIdentity());
  ipcMain.handle("get-recorder-in-process", () => !devServerUrl);
}

function registerExternalLinkHandler(): void {
  ipcMain.on("open-external", (_event, url: string) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) {
      void shell.openExternal(url);
    }
  });
}

function registerNotificationHandler(): void {
  ipcMain.handle("notify", (_event, { title, body }: { title: string; body: string }) =>
    postNotification(title, body),
  );
  // State lives here because the recorder in this process acts on it with no window.
  ipcMain.handle("get-notification-state", () => notificationState());
  ipcMain.handle("set-notifications-wanted", (_event, wanted: boolean) => {
    setPreference("notifications", wanted === true);
    return notificationState();
  });
  onPreferencesChanged(publishNotificationState);
}

/** The window's control over the throughput readout. macOS and Windows only:
 *  elsewhere these aren't registered and the preload omits them, so the settings
 *  toggle is absent, not dead. */
function registerMenuBarThroughputHandler(): void {
  if (!MENU_BAR_THROUGHPUT_SUPPORTED) return;
  ipcMain.handle("get-menubar-throughput", () => preferences().menuBarThroughput);
  ipcMain.handle("set-menubar-throughput", (_event, on: boolean) => {
    setPreference("menuBarThroughput", on === true);
    return preferences().menuBarThroughput;
  });
  // The open window's live throughput — the same 1s dish reading the dashboard draws.
  // The timestamp marks the renderer as reporting, so the recorder's poll defers.
  ipcMain.on("report-throughput", (_event, downBps: number, upBps: number) => {
    lastRendererReportMs = Date.now();
    if (!preferences().menuBarThroughput) return;
    latestThroughput = { downBps, upBps, atMs: lastRendererReportMs };
    applyMenuBarThroughput();
  });
  // One writer for both surfaces: a toggle from tray or window repaints, starts/stops
  // the watchdog, and tells any open window so its switch follows.
  onPreferencesChanged((prefs) => {
    applyMenuBarThroughput();
    updateThroughputWatchdog();
    mainWindow?.webContents.send(MENUBAR_THROUGHPUT_CHANNEL, prefs.menuBarThroughput);
  });
}

void app.whenReady().then(async () => {
  // Dev shows Electron's default icon; a packaged build carries its own, so set the
  // dock icon only in dev.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  // The cloud account belongs to this host, not to packaging; bound before the window
  // loads so the renderer's first /cloud/* call has somewhere to land.
  startCloud(rendererRoot);
  registerCloudHandlers();
  // Only the packaged app serves itself; in dev Vite proxies /api to the dev historian,
  // so a second collector here would double-poll the dish.
  if (!devServerUrl) {
    await startCollector(rendererRoot);
    handleAppProtocol(rendererRoot, handleApiRequest, handleCloudRequest);
    configureLoginItem();
    // Bound to the recorder just started, so alerting begins with the app, not a window.
    startAlertNotifications();
    startMenuBarThroughput();
  }
  // Registered for dev and packaged alike: notifications are the alerting channel.
  registerNotificationHandler();
  registerMenuBarThroughputHandler();
  registerUpdateHandler();
  registerExternalLinkHandler();
  registerHostHandlers();
  // checkForUpdates needs app-update.yml, which only a packaged build carries.
  if (app.isPackaged) startUpdateChecks();
  createTray();
  // A login-triggered launch stays in the tray (no window), so booting doesn't pop one.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createWindow();
});

// Lives in the tray after its window closes, so collection keeps running; quits only
// via the tray's Quit. Hence no quit on window-all-closed.
app.on("window-all-closed", () => {});

app.on("activate", showWindow);
