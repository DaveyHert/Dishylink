// Binds the host-agnostic cloud client to Electron and serves /cloud/* over the
// app:// protocol. The session cookie is held in the per-user data directory,
// encrypted with the OS keychain (safeStorage) rather than dev's plaintext file.
// The request logic — token refresh, the starlink.com calls — is the shared
// createCloudHandler; Node's global fetch honours the manually set Cookie header,
// exactly as the dev proxy relies on.

import { app, safeStorage, BrowserWindow, session } from "electron";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  appendFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createCloudHandler } from "../cloud/starlinkCloudHandler";
import { resilientFetch } from "../cloud/resilientFetch";
import { DishClient, DISH_LAN_HANDLE_URL, ROUTER_LAN_HANDLE_URL } from "../core/dishClient";
import type { DishConfigJson } from "../core/dishClient";
import { prepareDishConfigUpdate } from "../core/dishConfigUpdate";
import {
  buildRouterConfigRequest,
  readCurrentNetworks,
  readCurrentSubnet,
  readRouterWifiConfig,
  type RouterConfigUpdate,
} from "../core/routerConfigUpdate";
import { prepareRouterClientUpdate, readRouterClients } from "../core/routerClientUpdate";
import type { RouterClientUpdate } from "../core/routerClientUpdate";
import { hostIdentity } from "./selfDevice";

const LOGIN_URL = "https://www.starlink.com/account";
// The login window gets its own session, so signing out can wipe its Starlink
// cookies and a re-connect starts from a fresh login rather than reusing them.
const LOGIN_PARTITION = "persist:starlink-login";

let handler: ReturnType<typeof createCloudHandler> | null = null;
let cookieFile = "";
/** Set when the session file is shared with another process, which writes it as
 *  plain text. safeStorage is keyed to this app, so an encrypted one is private
 *  to it and nothing else on the machine could read the session out of it. */
let sharedCookieFile = false;

/** null, never "", so every reader agrees on what "no session" looks like. */
function readCookie(): string | null {
  try {
    if (!existsSync(cookieFile)) return null;
    const stored = readFileSync(cookieFile);
    const cookie =
      !sharedCookieFile && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(stored)
        : stored.toString("utf8");
    return cookie.trim() || null;
  } catch {
    return null;
  }
}

function writeCookie(cookie: string): void {
  const data =
    !sharedCookieFile && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(cookie)
      : Buffer.from(cookie, "utf8");
  writeFileSync(cookieFile, data);
}

function clearCookie(): void {
  try {
    rmSync(cookieFile);
  } catch {
    // already gone
  }
}

/** Roughly a day of calls at this app's rate, and small enough to paste. */
const TIMING_LOG_MAX_BYTES = 256 * 1024;

/** One line per cloud call into logs/cloud-timing.log. A write that fails here
 *  reports a deadline with no record of which call spent it, and the phase is
 *  the whole diagnosis. */
const timedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const name = url.includes("auth-rp")
    ? "auth"
    : url.includes("service-lines")
      ? "service-lines"
      : url.includes("telemetry")
        ? "telemetry"
        : url.includes("Handle")
          ? "gateway"
          : // Path only: a query string carries the session, and an account or
            // service-line number in the path is the customer's, not a route name.
            new URL(url).pathname.replace(/\/(AST|SL)-[\w-]+/gi, "/…");
  const started = Date.now();
  const note = (outcome: string) => {
    try {
      const directory = app.getPath("logs");
      mkdirSync(directory, { recursive: true });
      const file = join(directory, "cloud-timing.log");
      // Truncated rather than rotated: this is a rolling window for diagnosing
      // the call in front of you, not a record worth keeping.
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > TIMING_LOG_MAX_BYTES)
        rmSync(file);
      appendFileSync(
        file,
        `[${new Date().toISOString()}] ${name} ${Date.now() - started}ms ${outcome}\n`,
      );
    } catch {
      // Nowhere to write it is not worth failing the request over.
    }
  };
  try {
    const response = await resilientFetch(input, init);
    note(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    const held = error as { name?: string; code?: string; cause?: { code?: string } };
    note(`FAILED ${held.cause?.code ?? held.code ?? held.name ?? "unknown"}`);
    throw error;
  }
}) as typeof fetch;

/** Create the cloud client once, after the app is ready (the data path needs it). */
export function startCloud(rendererRoot: string, sessionFile?: string): void {
  cookieFile = sessionFile ?? join(app.getPath("userData"), "starlink-session.bin");
  sharedCookieFile = sessionFile !== undefined;
  const protosetPath = app.isPackaged
    ? join(rendererRoot, "dish.protoset")
    : join(app.getAppPath(), "public/dish.protoset");
  let routerPromise: Promise<DishClient> | null = null;
  let dishPromise: Promise<DishClient> | null = null;
  // Every router callback needs the same client, and the gateway ones need it
  // only as a codec — loading it dials nothing.
  const loadRouter = () =>
    (routerPromise ??= DishClient.load("router", {
      handleUrl: ROUTER_LAN_HANDLE_URL,
      protosetBytes: new Uint8Array(readFileSync(protosetPath)),
    }));
  handler = createCloudHandler({
    fetch: timedFetch,
    readCookie,
    writeCookie,
    clearCookie,
    prepareDeviceUpdate: async (update, targetId, callGateway) =>
      prepareRouterClientUpdate(await loadRouter(), update, targetId, callGateway, hostIdentity()),
    prepareDishConfigUpdate: async (changes) => {
      dishPromise ??= DishClient.load("dish", {
        handleUrl: DISH_LAN_HANDLE_URL,
        protosetBytes: new Uint8Array(readFileSync(protosetPath)),
      });
      return prepareDishConfigUpdate(await dishPromise, changes);
    },
    // Encoding only — the client is never dialled here, so this works on a kit
    // whose router answers nothing on the LAN. A subnet change reads the current
    // networks through the caller's gateway, which has the same reach.
    prepareRouterConfigUpdate: async (update, targetId, callGateway) => {
      const client = await loadRouter();
      const networks = await readCurrentNetworks(update, client, targetId, callGateway);
      return client.encodeRequest(buildRouterConfigRequest(targetId, update, networks));
    },
    readRouterSubnet: async (targetId, callGateway) =>
      readCurrentSubnet(await loadRouter(), targetId, callGateway),
    readRouterClients: async (targetId, callGateway) =>
      readRouterClients(await loadRouter(), targetId, callGateway),
    readRouterConfig: async (targetId, callGateway) =>
      readRouterWifiConfig(await loadRouter(), targetId, callGateway),
  });
}

/**
 * Pause or unpause a device from main, with no window involved.
 *
 * The recorder calls this when a device spends its data allowance, which happens
 * whether or not anyone is looking. It goes through the same queued, validated
 * path the renderer's own pause takes, so the two cannot build a client-config
 * write from stale snapshots of each other.
 */
/** Whether an account session exists for that write to go out on. */
export function accountSignedIn(): boolean {
  return handler !== null && readCookie() !== null;
}

export async function pauseDevice(clientId: number, paused: boolean): Promise<void> {
  if (!handler) throw new Error("Cloud not started");
  const { status, body } = await handler.updateClient({ kind: "pause", clientId, paused });
  if (status === 200) return;
  const message = (body as { message?: string })?.message ?? `HTTP ${status}`;
  throw new Error(status === 428 ? "No Starlink account connected" : message);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Serve one /cloud request: session connect/disconnect, or a data route. */
export async function handleCloudRequest(request: Request): Promise<Response> {
  if (!handler) return json(503, { error: "cloud not started" });
  const route = new URL(request.url).pathname;

  if (route === "/cloud/session") {
    if (request.method === "DELETE") {
      const { status, body } = handler.disconnect();
      // Also wipe the login window's Starlink cookies, so reconnecting starts from
      // a real sign-in instead of silently reusing the still-logged-in session.
      await session.fromPartition(LOGIN_PARTITION).clearStorageData({ storages: ["cookies"] });
      return json(status, body);
    }
    if (request.method === "POST") {
      const { cookie } = (await request.json().catch(() => ({}))) as { cookie?: string };
      const { status, body } = await handler.connect(cookie ?? "");
      return json(status, body);
    }
    return json(405, { error: "method_not_allowed" });
  }

  if (route === "/cloud/device" && request.method === "POST") {
    const update = (await request.json().catch(() => ({}))) as RouterClientUpdate;
    const { status, body } = await handler.updateClient(update);
    return json(status, body);
  }

  if (route === "/cloud/dish-config" && request.method === "POST") {
    const changes = (await request.json().catch(() => ({}))) as DishConfigJson;
    const { status, body } = await handler.updateDishConfig(changes);
    return json(status, body);
  }

  if (route === "/cloud/router-config" && request.method === "POST") {
    const update = (await request.json().catch(() => ({}))) as RouterConfigUpdate;
    const { status, body } = await handler.updateRouterConfig(update);
    return json(status, body);
  }

  const { status, body } = await handler.handle(route);
  return json(status, body);
}

/** Verify whatever session the login partition holds right now, connecting the
 *  account if it is good. null means there is no session there to try. */
async function verifyPartitionSession(): Promise<{ status: number; message?: string } | null> {
  const all = await session.fromPartition(LOGIN_PARTITION).cookies.get({ domain: "starlink.com" });
  const cookie = all.map((c) => `${c.name}=${c.value}`).join("; ");
  // Only a completed login carries the Sso cookie; earlier loads have none.
  if (!/Starlink\.Com\.Sso=/.test(cookie)) return null;
  const { status, body } = await handler!.connect(cookie);
  return { status, message: (body as { message?: string }).message };
}

/**
 * Connect the account from a real Starlink login, with no copy-paste. A partition
 * that is still signed in is adopted without showing anything at all; otherwise a
 * login window opens and the session is taken the moment it exists. Resolves when
 * connected, or when the user closes the window.
 */
export async function signIn(parent?: BrowserWindow): Promise<{ ok: boolean; message?: string }> {
  if (!handler) return { ok: false, message: "Cloud not started." };
  // Reconnecting an account whose login is still live needs no window: the session
  // is already in the jar, so showing starlink.com would only flash the site up and
  // tear it down again.
  const existing = await verifyPartitionSession();
  if (existing?.status === 200) return { ok: true };
  return openLoginWindow(parent);
}

function openLoginWindow(parent?: BrowserWindow): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1124,
      height: 800,
      parent,
      modal: Boolean(parent),
      title: "Sign in to Starlink",
      autoHideMenuBar: true,
      webPreferences: { partition: LOGIN_PARTITION },
    });
    // macOS draws a modal child window as a sheet: attached to the parent, and
    // with no title bar of its own, so it carries no close button — `isClosable()`
    // still answers true, but there is nothing on screen to click. Escape is the
    // platform's own cancel gesture for a sheet, and intercepting the key before
    // the page sees it keeps starlink.com from swallowing it. Closing here lands
    // on the `closed` handler below, which resolves the cancelled result.
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") win.close();
    });

    const cookies = session.fromPartition(LOGIN_PARTITION).cookies;
    // A verified session is the only thing that latches. An attempt that fails
    // proves nothing about the next one, so failure must not close the door.
    let connected = false;
    let adopting = false;

    async function tryAdopt(): Promise<void> {
      if (connected || adopting) return;
      adopting = true;
      try {
        // The session is minted over a series of redirects, and the durable Sso
        // cookie can land a beat before the short-lived token that authorizes it.
        // So re-read the jar on every attempt: replaying one snapshot can only
        // reproduce that snapshot's own failure, which is what made a cold login
        // report "didn't authenticate" while the very next one succeeded.
        let rejected: { status: number; message?: string } | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt > 0) await new Promise((wait) => setTimeout(wait, 700));
          const result = await verifyPartitionSession();
          if (!result) continue;
          if (result.status === 200) {
            connected = true;
            win.destroy();
            resolve({ ok: true });
            return;
          }
          rejected = result;
        }
        // Every read of a real session was refused, so the session is the problem:
        // close and say so, rather than leaving the user parked on their signed-in
        // account with nothing indicating the app didn't take it. An upstream fault
        // (502) is not that verdict — leave the window up so a later load retries.
        if (rejected && rejected.status !== 502) {
          win.destroy();
          resolve({ ok: false, message: rejected.message });
        }
      } finally {
        adopting = false;
      }
    }

    // The durable cookie being written IS the completed login — it happens during
    // the redirect right after the code is verified, well before the account page
    // has rendered. Waiting on did-finish-load instead meant sitting on Starlink's
    // dashboard for seconds with the session already in hand.
    const onCookieChanged = (
      _event: unknown,
      cookie: { name: string; domain?: string },
      _cause: unknown,
      removed: boolean,
    ) => {
      if (removed || cookie.name !== "Starlink.Com.Sso") return;
      if (!/(^|\.)starlink\.com$/.test(cookie.domain ?? "")) return;
      void tryAdopt();
    };
    cookies.on("changed", onCookieChanged);

    // Kept as the backstop: a jar that already holds the session fires no change
    // event, so on that path a finished load is the only thing left to react to.
    win.webContents.on("did-finish-load", () => void tryAdopt());
    win.on("closed", () => {
      // The listener lives on the partition's session, not the window, so it would
      // outlive this sign-in and stack up across the next ones.
      cookies.removeListener("changed", onCookieChanged);
      // A close we initiated has already resolved with its own verdict, so this only
      // ever speaks for the user closing the window themselves.
      if (!connected) resolve({ ok: false, message: "Sign-in was cancelled." });
    });
    void win.loadURL(LOGIN_URL);
  });
}
