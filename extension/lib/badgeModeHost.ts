// The extension's side of the badge setting. It lives in chrome.storage.local,
// not the page's localStorage, which the service worker cannot see.

import { browser } from "wxt/browser";
import {
  DEFAULT_BADGE_MODE,
  isBadgeMode,
  type BadgeMode,
  type BadgeModeBinding,
} from "@/lib/badgeMode";

export const BADGE_MODE_KEY = "badgeMode";

export async function storedBadgeMode(): Promise<BadgeMode> {
  const stored = await browser.storage.local.get(BADGE_MODE_KEY);
  const value = stored[BADGE_MODE_KEY];
  return isBadgeMode(value) ? value : DEFAULT_BADGE_MODE;
}

export const extensionBadgeModeHost: BadgeModeBinding = {
  read: storedBadgeMode,
  async write(mode: BadgeMode): Promise<void> {
    await browser.storage.local.set({ [BADGE_MODE_KEY]: mode });
  },
};
