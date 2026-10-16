// The Electron main process: the app's one privileged host — window, tray, and the
// in-process collector. The sandboxed renderer reaches it only through the preload
// bridge (no localhost port). The app is a background recorder that keeps running in
// the tray after its window closes, quitting only via the tray's Quit.

import {
  app,
  BrowserWindow,
  dialog,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  screen,
  shell,
  type MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
import { hostIdentity, rememberSelfDevice } from "./selfDevice";
import { normalizeIpAddress, type RouterAddress } from "../core/ipAddress";
import { ROUTER_LAN_ADDRESS } from "../core/dishClient";
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
  HIDE_TRAY_ICON_CHANNEL,
  TRAY_ICON_STYLE_CHANNEL,
  UPDATE_STATE_CHANNEL,
} from "./ipc";
import { formatMenuBarRate, formatSpacedRate } from "./menuBarThroughput";
import {
  showThroughputWidget,
  paintThroughputWidget,
  hideThroughputWidget,
} from "./throughputWidget";
import {
  startUpdateChecks,
  checkForUpdates,
  updateState,
  onUpdateStateChanged,
  installUpdate,
} from "./updater";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(here, "../dist");
const iconPath = join(here, "../build/icon.png");
const trayIconPath = join(here, "../build/trayTemplate.png");
const trayOutlinePath = join(here, "../build/trayTemplateOutline.png");

// Drives the menu-bar title and per-app data directory; must be set before anything
// reads it.
app.setName("Dishylink");

// Must run before the app is ready, so it's at module load rather than in whenReady.
registerAppProtocolScheme();

// This process keeps a recorder and a cloud session reaching the network with no
// window open, so a route that goes away under a request in flight — sleep, a
// VPN, switching the router into bypass — arrives here as a modal "A JavaScript
// error occurred" box the user can neither act on nor prevent. Only that class
// is absorbed; anything else is re-thrown and stays as fatal as it was, because
// a guard that hid real faults would trade a visible crash for a silent one.
const NETWORK_FAILURES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

function networkFailure(value: unknown): boolean {
  const code = (value as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && NETWORK_FAILURES.has(code);
}

/** The last thing written, so a machine that stays offline repeating the same
 *  failure every tick does not grow the file without bound. */
let lastFailureLogged = "";

function logFailure(kind: string, value: unknown): void {
  // The code lives on the object rather than in the message, and without it a
  // network fault reads as an ordinary error.
  const detail =
    value instanceof Error
      ? `${(value as NodeJS.ErrnoException).code ?? ""} ${value.stack ?? value.message}`.trim()
      : String(value);
  console.error(`[main] ${kind}: ${detail}`);
  if (detail === lastFailureLogged) return;
  lastFailureLogged = detail;
  try {
    const directory = app.getPath("logs");
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      join(directory, "main.log"),
      `[${new Date().toISOString()}] ${kind}: ${detail}\n`,
    );
  } catch {
    // Nowhere to write it is not itself worth bringing the app down for.
  }
}

// Installing a handler replaces Electron's, which is what puts the box on
// screen, so anything not absorbed has to raise it again: a real fault must stay
// exactly as loud and as fatal as it is without this. Re-throwing from here does
// not recurse — Node exits with the stack printed.
function fatal(kind: string, value: unknown): never {
  const detail = value instanceof Error ? (value.stack ?? value.message) : String(value);
  try {
    dialog.showErrorBox("A JavaScript error occurred in the main process", detail);
  } catch {
    // Before the app is ready there is no window server to ask; the throw stands.
  }
  throw value instanceof Error ? value : new Error(`${kind}: ${detail}`);
}

process.on("unhandledRejection", (reason) => {
  logFailure("unhandled rejection", reason);
  if (!networkFailure(reason)) fatal("unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
  logFailure("uncaught exception", error);
  if (!networkFailure(error)) fatal("uncaught exception", error);
});

// Set by vite-plugin-electron while serving; absent in a packaged build.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayMenu: Menu | null = null;

const NOTIFY_ITEM_ID = "notify-alerts";
const NOTIFY_REASON_ITEM_ID = "notify-alerts-reason";
const THROUGHPUT_ITEM_ID = "menubar-throughput";
const HIDE_ICON_ITEM_ID = "hide-tray-icon";
const START_ON_SYSTEM_START_ITEM_ID = "start-on-system-start";
const ABOUT_ITEM_ID = "about-dishylink";

// Tray and application menu items updated in place after build (rebuilding would
// drop an open popup and could leave the two surfaces out of sync).
let notifyItems: MenuItem[] = [];
let notifyReasonItems: MenuItem[] = [];
let throughputItems: MenuItem[] = [];
let hideIconItems: MenuItem[] = [];
let startOnSystemStartItems: MenuItem[] = [];
let updateItems: MenuItem[] = [];

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

/** The macOS menu-bar image for the current preference. */
function macTrayImage() {
  const style = preferences().trayIconStyle;
  if (style === "original") {
    const image = nativeImage.createFromPath(iconPath);
    return image.isEmpty() ? image : image.resize({ width: 18, height: 18 });
  }
  const image = nativeImage.createFromPath(style === "outline" ? trayOutlinePath : trayIconPath);
  image.setTemplateImage(true);
  return image;
}

function linuxAutostartFile(): string {
  return join(app.getPath("appData"), "autostart", "dishylink.desktop");
}

/** Read one XDG autostart entry. A per-user entry can disable an entry installed
 *  system-wide by setting Hidden=true, or can enable/disable its own entry with
 *  X-GNOME-Autostart-enabled. */
function autostartEntryEnabled(path: string): boolean | null {
  try {
    const entry = readFileSync(path, "utf8");
    if (/^Hidden\s*=\s*true\s*$/im.test(entry)) return false;
    if (/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(entry)) return false;
    return true;
  } catch {
    return null;
  }
}

function systemAutostartEnabled(): boolean {
  const configDirs = (process.env.XDG_CONFIG_DIRS || "/etc/xdg").split(":").filter(Boolean);
  for (const directory of configDirs) {
    const enabled = autostartEntryEnabled(join(directory, "autostart", "dishylink.desktop"));
    if (enabled !== null) return enabled;
  }
  return false;
}

function startOnSystemStartEnabled(): boolean {
  if (process.platform !== "linux") return app.getLoginItemSettings().openAtLogin;
  return autostartEntryEnabled(linuxAutostartFile()) ?? systemAutostartEnabled();
}

/** Linux's supported startup hook is an XDG autostart desktop file. A user-level
 *  Hidden=true entry overrides the package's system-wide default without editing
 *  a root-owned file; removing that override restores the package default. */
function setLinuxAutostart(enabled: boolean): void {
  const path = linuxAutostartFile();
  const userEnabled = autostartEntryEnabled(path);
  const systemEnabled = systemAutostartEnabled();

  if (enabled) {
    if (userEnabled === true) return;
    if (systemEnabled) {
      if (userEnabled === false) unlinkSync(path);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    const executable = process.execPath
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%");
    writeFileSync(
      path,
      `[Desktop Entry]\nType=Application\nName=Dishylink\nComment=Starlink network monitoring and control\nExec="${executable}" --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
    );
    return;
  }

  if (systemEnabled) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      "[Desktop Entry]\nType=Application\nName=Dishylink\nHidden=true\nX-GNOME-Autostart-enabled=false\n",
    );
  } else if (userEnabled !== null) {
    unlinkSync(path);
  }
}

function setStartOnSystemStart(enabled: boolean): void {
  if (process.platform === "linux") setLinuxAutostart(enabled);
  else app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled });
}

function toggleStartOnSystemStart(enabled: boolean): void {
  try {
    setStartOnSystemStart(enabled);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Couldn’t update startup setting", detail);
  }
  const actual = startOnSystemStartEnabled();
  for (const item of startOnSystemStartItems) item.checked = actual;
}

function showAbout(): void {
  const detail = [
    `Version: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Chromium: ${process.versions.chrome}`,
    `Node.js: ${process.versions.node}`,
    "",
    "Created by Davey Hert.",
    "Linux packaging, tray integration, startup controls, and collector reliability: Matthew Hale (@haleme-chs).",
    "",
    "Open-source Starlink monitoring app.",
  ].join("\n");
  const options = {
    type: "info" as const,
    title: "About Dishylink",
    message: "Dishylink",
    detail,
    buttons: ["Dishylink on GitHub", "@haleme-chs on GitHub", "Close"],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  };
  const dialogResult =
    mainWindow?.isVisible() === true
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);
  void dialogResult.then(({ response }) => {
    const url =
      response === 0
        ? "https://github.com/DaveyHert/dishylink"
        : response === 1
          ? "https://github.com/haleme-chs"
          : null;
    if (url !== null)
      void shell.openExternal(url).catch((error: unknown) => logFailure("open about link", error));
  });
}

function menuTemplate(): MenuItemConstructorOptions[] {
  const linux = process.platform === "linux";
  const notifyMenuItem: MenuItemConstructorOptions = {
    id: NOTIFY_ITEM_ID,
    label: "Notify Me About Alerts",
    type: "checkbox",
    checked: notificationsRequested(notificationState()),
    click: (item) => {
      setPreference("notifications", item.checked);
      if (item.checked)
        void postNotification(
          NOTIFICATIONS_ON_CONFIRMATION.title,
          NOTIFICATIONS_ON_CONFIRMATION.body,
        ).catch(() => {});
    },
  };
  const updateMenuItem: MenuItemConstructorOptions = {
    id: "update-dishylink",
    label: "Check for Updates",
    enabled: true,
    click: () => {
      if (updateState().ready) void installUpdate();
      else checkForUpdates();
    },
  };

  return [
    { label: linux ? "Show Dishylink" : "Open Dishylink", click: showWindow },
    { type: "separator" },
    updateMenuItem,
    notifyMenuItem,
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
    ...(process.platform === "darwin"
      ? [
          {
            id: HIDE_ICON_ITEM_ID,
            label: "Hide Menu Bar Icon",
            type: "checkbox" as const,
            checked: preferences().hideTrayIcon,
            visible: preferences().menuBarThroughput,
            click: (item: MenuItem) => setPreference("hideTrayIcon", item.checked),
          },
        ]
      : []),
    {
      id: START_ON_SYSTEM_START_ITEM_ID,
      label: "Start on System Start",
      type: "checkbox",
      enabled: app.isPackaged,
      checked: app.isPackaged && startOnSystemStartEnabled(),
      click: (item) => toggleStartOnSystemStart(item.checked),
    },
    { type: "separator" },
    { id: ABOUT_ITEM_ID, label: "About", click: showAbout },
    { type: "separator" },
    { label: linux ? "Quit" : "Quit Dishylink", role: "quit" },
  ];
}

function createTray(): void {
  const linux = process.platform === "linux";
  if (process.platform === "darwin") {
    tray = new Tray(macTrayImage());
  } else {
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? image : image.resize({ width: 18, height: 18 }));
  }
  tray.setToolTip("Dishylink");

  const menu = Menu.buildFromTemplate(menuTemplate());
  const applicationMenu = Menu.buildFromTemplate([
    { label: "App", submenu: menuTemplate() },
    { role: "viewMenu" },
  ]);
  Menu.setApplicationMenu(applicationMenu);
  const appMenu = applicationMenu.items[0]?.submenu ?? null;
  const menus = appMenu === null ? [menu] : [menu, appMenu];
  const itemsById = (id: string) =>
    menus
      .map((currentMenu) => currentMenu.getMenuItemById(id))
      .filter((item): item is MenuItem => item !== null);

  trayMenu = menu;
  notifyItems = itemsById(NOTIFY_ITEM_ID);
  notifyReasonItems = itemsById(NOTIFY_REASON_ITEM_ID);
  throughputItems = itemsById(THROUGHPUT_ITEM_ID);
  hideIconItems = itemsById(HIDE_ICON_ITEM_ID);
  startOnSystemStartItems = itemsById(START_ON_SYSTEM_START_ITEM_ID);
  updateItems = itemsById("update-dishylink");
  applyUpdateMenu();
  applyMenuBarThroughput();
  updateThroughputWatchdog();
  // StatusNotifierItem activation isn't guaranteed to arrive as a left-click event.
  // Attaching the menu lets Electron's Linux backend show it for native activation.
  if (linux) {
    tray.setContextMenu(menu);
  } else {
    tray.on("click", showWindow);
    tray.on("right-click", () => tray?.popUpContextMenu(menu));
  }
}

/** "↓39Kb/s ↑159Kb/s". Padded to a fixed width so the icon holds while the
 *  numbers swing in the leading gap — but that gap is dead space once the icon
 *  is hidden, so `padded` drops it for that case. */
function throughputTitle(downBps: number, upBps: number, padded = true): string {
  const readout = `↓${formatMenuBarRate(downBps)} ↑${formatMenuBarRate(upBps)}`;
  return padded ? readout.padStart(THROUGHPUT_TITLE_WIDTH, FIGURE_SPACE) : readout;
}

/** Blank the tray icon when the readout stands in for it, else show the template
 *  glyph. macOS only; the guard against a hidden icon with no title lives in the
 *  `menuBarThroughput` half of the condition. */
function applyTrayIcon(): void {
  if (tray === null || process.platform !== "darwin") return;
  const hidden = preferences().menuBarThroughput && preferences().hideTrayIcon;
  tray.setImage(hidden ? nativeImage.createEmpty() : macTrayImage());
}

/** Paint the readout from the latest throughput, or clear it when off. A stale
 *  sample (dish unreachable) reads as 0, not a frozen value. macOS writes the tray
 *  title; Windows drives the floating widget. */
function applyMenuBarThroughput(): void {
  if (!MENU_BAR_THROUGHPUT_SUPPORTED || tray === null) return;
  const on = preferences().menuBarThroughput;
  for (const item of throughputItems) item.checked = on;
  for (const item of hideIconItems) item.visible = on;
  applyTrayIcon();
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
    tray.setTitle(throughputTitle(downBps, upBps, !preferences().hideTrayIcon), {
      fontType: "monospaced",
    });
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
    // A dev run must not leave a login item pointing at node_modules/electron.
    if (process.platform !== "linux" && app.getLoginItemSettings().openAtLogin)
      app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  const marker = join(app.getPath("userData"), ".setup-done");
  if (existsSync(marker)) return;
  setStartOnSystemStart(true);
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
  for (const item of notifyItems) item.checked = notificationsRequested(state);
  const problem = notificationsProblem(state);
  for (const item of notifyReasonItems) {
    item.visible = problem !== null;
    item.label = problem ?? "";
  }
  refreshLinuxTrayMenu();
  mainWindow?.webContents.send(NOTIFICATION_STATE_CHANNEL, state);
}

/** Single writer of the update state to the window. */
function publishUpdateState(): void {
  applyUpdateMenu();
  refreshLinuxTrayMenu();
  mainWindow?.webContents.send(UPDATE_STATE_CHANNEL, updateState());
}

/** Linux caches the native context menu, so reattach it after menu item changes. */
function refreshLinuxTrayMenu(): void {
  if (process.platform === "linux" && tray !== null && trayMenu !== null) {
    tray.setContextMenu(trayMenu);
  }
}

function applyUpdateMenu(): void {
  if (updateItems.length === 0) return;
  const state = updateState();
  let label = "Check for Updates";
  let enabled = true;
  if (state.installing) {
    label = "Installing Dishylink update…";
    enabled = false;
  } else if (state.ready && state.version) {
    label = `Install update ${state.version}`;
  } else if (state.available && state.version) {
    label = `Update available: ${state.version}`;
  }
  for (const item of updateItems) {
    item.label = label;
    item.enabled = enabled;
  }
}

function registerUpdateHandler(): void {
  ipcMain.handle("get-update-state", () => updateState());
  ipcMain.handle("install-update", () => installUpdate());
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
  // from the host's own interfaces, plus the roster entry a window on the router's
  // network has since matched to them.
  ipcMain.handle("get-self-identity", () => hostIdentity());
  // Written whenever the window resolves this machine on a roster read over the LAN.
  ipcMain.handle("remember-self-device", (_event, clientId: unknown) => {
    if (typeof clientId === "number") rememberSelfDevice(clientId);
  });
  ipcMain.handle("get-recorder-in-process", () => !devServerUrl);
  ipcMain.handle("get-router-address", () => routerAddress());
  // An address that does not parse is rejected here rather than stored and
  // silently ignored later, so the window can tell the user it was refused.
  ipcMain.handle("set-router-address", (_event, address: string | null): RouterAddress | null => {
    const normalized = address === null ? null : normalizeIpAddress(address);
    if (address !== null && normalized === null) return null;
    setPreference("routerAddress", normalized);
    return routerAddress();
  });
}

/** The window shows the default as a placeholder, so it is told it rather than
 *  keeping its own copy that could drift from what this process actually dials. */
function routerAddress(): RouterAddress {
  return { router: preferences().routerAddress, routerDefault: ROUTER_LAN_ADDRESS };
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
  if (process.platform === "darwin") {
    ipcMain.handle("get-hide-tray-icon", () => preferences().hideTrayIcon);
    ipcMain.handle("set-hide-tray-icon", (_event, hidden: boolean) => {
      setPreference("hideTrayIcon", hidden === true);
      return preferences().hideTrayIcon;
    });
    ipcMain.handle("get-tray-icon-style", () => preferences().trayIconStyle);
    ipcMain.handle("set-tray-icon-style", (_event, style: unknown) => {
      setPreference(
        "trayIconStyle",
        style === "template" || style === "outline" ? style : "original",
      );
      return preferences().trayIconStyle;
    });
  }
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
    for (const item of hideIconItems) item.checked = prefs.hideTrayIcon;
    mainWindow?.webContents.send(HIDE_TRAY_ICON_CHANNEL, prefs.hideTrayIcon);
    mainWindow?.webContents.send(TRAY_ICON_STYLE_CHANNEL, prefs.trayIconStyle);
  });
}

void app.whenReady().then(async () => {
  // A second launch (the desktop shortcut while the tray copy runs) would start a
  // second collector and crash on the data-dir writer lock; hand the launch to the
  // running instance instead.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", showWindow);
  // Dev shows Electron's default icon; a packaged build carries its own, so set the
  // dock icon only in dev.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  // The cloud account belongs to this host, not to packaging; bound before the window
  // loads so the renderer's first /cloud/* call has somewhere to land.
  // Against a dev server, the session is the one that server's cloud proxy holds:
  // the recorder runs inside it, so a separate session here would leave a window
  // signed in and its own limits unenforceable.
  startCloud(rendererRoot, devServerUrl ? resolve(process.cwd(), ".starlink-cookie") : undefined);
  registerCloudHandlers();
  // A dev server runs its own recorder; a second collector here would double-poll
  // the dish.
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
  if (!app.getLoginItemSettings().wasOpenedAtLogin && !process.argv.includes("--hidden"))
    createWindow();
});

// Lives in the tray after its window closes, so collection keeps running; quits only
// via the tray's Quit. Hence no quit on window-all-closed.
app.on("window-all-closed", () => {});

app.on("activate", showWindow);
