// The dish's and router's grpc-web endpoints, reached directly. Host permissions
// exempt the extension from the CORS and Local Network Access limits a web page
// hits, so unlike the dev server and the desktop app it needs no same-origin
// proxy in front of the LAN boxes.
//
// The defaults are in the manifest's static host_permissions. An address the user
// configures cannot be — MV3 fixes those at build time — so it is granted at the
// moment it is saved, out of optional_host_permissions. Until that grant exists a
// fetch to it is blocked, so the grant is what a save waits on.

import { browser } from "wxt/browser";
import { normalizeIpAddress, originFor } from "@core/ipAddress";

export const DISH_LAN_ADDRESS = "192.168.100.1";
export const ROUTER_LAN_ADDRESS = "192.168.1.1";
const DISH_PORT = 9201;
const ROUTER_PORT = 9001;
const HANDLE_PATH = "/SpaceX.API.Device.Device/Handle";

const STORAGE_KEY = "routerAddress";

export interface StoredAddresses {
  router: string | null;
}

/**
 * Held in memory so the many call sites that build a URL stay synchronous, and
 * refreshed from storage whenever it changes. browser.storage is async, and a
 * handle URL is wanted inside request paths that cannot await a read.
 */
let current: StoredAddresses = { router: null };

function readStored(value: unknown): StoredAddresses {
  const stored = (value ?? {}) as Partial<Record<keyof StoredAddresses, unknown>>;
  return {
    router: typeof stored.router === "string" ? normalizeIpAddress(stored.router) : null,
  };
}

/** Called by both the worker and the dashboard before they dial the router. */
export async function loadRouterAddress(): Promise<StoredAddresses> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    current = readStored(stored[STORAGE_KEY]);
  } catch {
    current = { router: null };
  }
  return current;
}

/** Both surfaces run in their own context with their own copy, so each follows
 *  the store rather than the one that made the change. */
export function watchRouterAddress(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    current = readStored(changes[STORAGE_KEY].newValue);
  });
}

export function routerAddress(): StoredAddresses {
  return current;
}

export type StoreResult =
  | { ok: true; addresses: StoredAddresses }
  | { ok: false; reason: "invalid" | "denied" | "unsupported" };

/**
 * Store an address, first obtaining permission to reach it.
 *
 * The permission request must be called from a user gesture, which the save
 * button is. A user who declines leaves nothing stored: keeping an address the
 * extension is not allowed to fetch would present a setting that silently does
 * nothing.
 *
 * An IPv6 address is refused outright. Chrome match patterns have no way to
 * express one, so no grant could ever cover it, and storing it would produce a
 * setting that looks accepted and never works.
 */
export async function storeRouterAddress(address: string | null): Promise<StoreResult> {
  const normalized = address === null ? null : normalizeIpAddress(address);
  if (address !== null && normalized === null) return { ok: false, reason: "invalid" };

  if (normalized !== null) {
    if (normalized.includes(":")) return { ok: false, reason: "unsupported" };
    const origins = [`http://${normalized}/*`];
    const granted = await browser.permissions.request({ origins }).catch(() => false);
    if (!granted) return { ok: false, reason: "denied" };
  }

  const next = { router: normalized };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  current = next;
  return { ok: true, addresses: next };
}

export function dishHandleUrl(): string {
  return originFor(DISH_LAN_ADDRESS, DISH_PORT) + HANDLE_PATH;
}

export function routerHandleUrl(): string {
  const configured = routerAddress().router;
  return originFor(configured ?? ROUTER_LAN_ADDRESS, ROUTER_PORT) + HANDLE_PATH;
}
