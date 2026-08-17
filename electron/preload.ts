// The preload is the single, deliberately narrow bridge between the sandboxed
// renderer and the privileged main process. It exposes a small typed surface on
// window.dishlink; every capability the UI needs from the host (collector data,
// dish/router/cloud transport, sign-in) is added here as an explicit method, never
// by handing the renderer raw Node, IPC, or Electron objects.

import { contextBridge, ipcRenderer } from "electron";
import type { NotificationState } from "../core/alertNotification";
import type { HostNetworkIdentity } from "../core/hostNetworkIdentity";
import type { RouterAddress } from "../core/ipAddress";
import {
  NOTIFICATION_STATE_CHANNEL,
  MENUBAR_THROUGHPUT_CHANNEL,
  UPDATE_STATE_CHANNEL,
} from "./ipc";
import type { UpdateState } from "./updater";

contextBridge.exposeInMainWorld("dishlink", {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // So the renderer can word a control for the host it runs on (menu bar on
  // macOS, taskbar on Windows) without sniffing the user agent.
  platform: process.platform,
  // The renderer has no shell access, so this crosses to main.
  openExternal: (url: string): void => {
    ipcRenderer.send("open-external", url);
  },
  selfIdentity: (): Promise<HostNetworkIdentity> => ipcRenderer.invoke("get-self-identity"),
  // The roster entry this machine matched over the LAN, kept by main so the
  // self-pause refusal there still knows this device off that network.
  rememberSelfDevice: (clientId: number): Promise<void> =>
    ipcRenderer.invoke("remember-self-device", clientId),
  recorderInProcess: (): Promise<boolean> => ipcRenderer.invoke("get-recorder-in-process"),
  // Where this process dials the router. Main owns it because the recorder there
  // dials with no window open.
  routerAddress: (): Promise<RouterAddress> => ipcRenderer.invoke("get-router-address"),
  setRouterAddress: (address: string | null): Promise<RouterAddress | null> =>
    ipcRenderer.invoke("set-router-address", address),
  // Opens the Starlink login window in the main process; resolves once the account
  // is connected, or with ok:false if the user closes it.
  signIn: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke("starlink-signin"),
  // Answers the renderer's /cloud/* calls from the main process, which is where
  // the account session lives. The window's own origin only serves those routes
  // when it is loaded over app://; on the dev server it is Vite's origin, whose
  // middleware keeps a different session store. Going through main makes the
  // desktop app use one session either way.
  cloud: (request: {
    path: string;
    method?: string;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }> => ipcRenderer.invoke("cloud-request", request),
  // Posts a desktop notification from the main process, resolving to whether the
  // OS actually delivered it and, when it didn't, why — the packaged-vs-unsigned
  // reason only main can tell.
  //
  // The renderer's own Notification API is not usable in the packaged app: it
  // loads over app://, and asking a sandboxed custom-origin renderer for
  // notification permission leaves `Notification.permission` somewhere other than
  // "granted" — so the app's own "enabled" check could never become true and the
  // toggle could never turn on. Main has no such gate; it talks to the OS
  // directly, and macOS prompts once for the app itself rather than for a web
  // origin. Every run routes through main, so dev behaves as the packaged app does.
  notify: (title: string, body: string): Promise<{ delivered: boolean; reason?: string }> =>
    ipcRenderer.invoke("notify", { title, body }),
  // Whether alerts should be announced, and whether they can be. Owned by main
  // because main is what announces them: the recorder there finds an alert
  // whether or not a window exists, so a preference kept in this window's
  // localStorage would be unreadable at exactly the moment it is needed.
  notificationState: (): Promise<NotificationState> => ipcRenderer.invoke("get-notification-state"),
  // Records the request only. Whether it can be delivered is main's to observe,
  // and comes back in the state.
  setNotificationsWanted: (wanted: boolean): Promise<NotificationState> =>
    ipcRenderer.invoke("set-notifications-wanted", wanted),
  // The same state whenever it changes, including once per page load. The tray
  // can turn notifications on while this window is open, and the OS can stop
  // delivering them, so a window that only asked at startup would sit on an
  // answer that has since moved.
  onNotificationState: (listener: (state: NotificationState) => void): (() => void) => {
    const handler = (_event: unknown, state: NotificationState): void => listener(state);
    ipcRenderer.on(NOTIFICATION_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(NOTIFICATION_STATE_CHANNEL, handler);
    };
  },
  // Whether a GitHub release newer than this build has been published. Detection
  // only — nothing here downloads or installs anything; see electron/updater.ts.
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke("get-update-state"),
  onUpdateState: (listener: (state: UpdateState) => void): (() => void) => {
    const handler = (_event: unknown, state: UpdateState): void => listener(state);
    ipcRenderer.on(UPDATE_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(UPDATE_STATE_CHANNEL, handler);
    };
  },
  // The live throughput readout — the macOS menu-bar tray title or the Windows
  // floating widget — so these are exposed on those two platforms only. The renderer
  // keys the settings toggle off their presence: absent here, absent from the UI,
  // with no platform check of its own. Owned by main because main owns the tray and
  // the widget the readout rides on.
  ...(process.platform === "darwin" || process.platform === "win32"
    ? {
        menuBarThroughput: (): Promise<boolean> => ipcRenderer.invoke("get-menubar-throughput"),
        setMenuBarThroughput: (on: boolean): Promise<boolean> =>
          ipcRenderer.invoke("set-menubar-throughput", on),
        // The window's live dish throughput, forwarded to the readout so it shows
        // the same number the dashboard does. Fire-and-forget: it fires once a
        // second and the readout is cosmetic, so nothing waits on it.
        reportThroughput: (downBps: number, upBps: number): void => {
          ipcRenderer.send("report-throughput", downBps, upBps);
        },
        onMenuBarThroughput: (listener: (on: boolean) => void): (() => void) => {
          const handler = (_event: unknown, on: boolean): void => listener(on);
          ipcRenderer.on(MENUBAR_THROUGHPUT_CHANNEL, handler);
          return () => {
            ipcRenderer.off(MENUBAR_THROUGHPUT_CHANNEL, handler);
          };
        },
      }
    : {}),
});
