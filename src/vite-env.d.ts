/// <reference types="vite/client" />

// Injected by vite.config.ts / wxt.config.ts's `define`, from package.json's
// "version" — the one field a release actually keys off.
declare const __APP_VERSION__: string;

interface RouterAddress {
  router: string | null;
  routerDefault: string;
}

// Exposed by the Electron preload bridge; absent in the browser and extension.
interface Window {
  dishlink?: {
    versions: { electron: string; chrome: string };
    // The host OS ("darwin" | "win32" | "linux" | …), so a control can name the
    // right surface (menu bar vs taskbar) without sniffing the user agent.
    platform: string;
    // The renderer has no shell access, so opening links crosses to main.
    openExternal: (url: string) => void;
    signIn: () => Promise<{ ok: boolean; message?: string }>;
    cloud: (request: {
      path: string;
      method?: string;
      body?: unknown;
    }) => Promise<{ status: number; body: unknown }>;
    selfIdentity: () => Promise<{
      ipAddresses: string[];
      macAddresses: string[];
      clientId?: number;
    }>;
    rememberSelfDevice?: (clientId: number) => Promise<void>;
    recorderInProcess: () => Promise<boolean>;
    // Where the host dials the router, with the default it falls back to. Absent
    // on hosts that reach it some other way, which is what keeps the setting from
    // rendering there.
    routerAddress?: () => Promise<RouterAddress>;
    setRouterAddress?: (address: string | null) => Promise<RouterAddress | null>;
    // The throughput-readout controls — macOS menu bar or Windows taskbar —
    // exposed by the preload only on those platforms, so they are optional, and
    // the settings toggle renders only where `setMenuBarThroughput` is present.
    menuBarThroughput?: () => Promise<boolean>;
    setMenuBarThroughput?: (on: boolean) => Promise<boolean>;
    onMenuBarThroughput?: (listener: (on: boolean) => void) => () => void;
    reportThroughput?: (downBps: number, upBps: number) => void;
    // Whether a GitHub release newer than this build has been published.
    updateState: () => Promise<{ available: boolean; version: string | null }>;
    onUpdateState: (
      listener: (state: { available: boolean; version: string | null }) => void,
    ) => () => void;
  };
}
