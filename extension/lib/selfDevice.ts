// The roster entry the user named as the device the dashboard runs on.
//
// Held in chrome.storage rather than the page's localStorage because the service
// worker reads it too: the worker is what refuses a pause aimed at this device,
// and it cannot see anything the page keeps to itself.

import { browser } from "wxt/browser";

const STORAGE_KEY = "selfDeviceClientId";

export async function loadSelfDeviceClientId(): Promise<number | null> {
  try {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return Number.isInteger(stored) ? (stored as number) : null;
  } catch {
    return null;
  }
}

export async function storeSelfDeviceClientId(clientId: number | null): Promise<void> {
  if (clientId === null) await browser.storage.local.remove(STORAGE_KEY);
  else await browser.storage.local.set({ [STORAGE_KEY]: clientId });
}
