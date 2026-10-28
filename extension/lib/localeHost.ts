// The extension's side of the interface language. The dashboard page settles on
// a language in its own localStorage; the service worker, which posts toasts
// between wakes, cannot read that, so the page mirrors it into chrome.storage.

import { browser } from "wxt/browser";
import { isSupportedLocale, localeFromLanguageTags, type SupportedLocale } from "@core/i18n/locale";
import type { LocaleHost } from "@/lib/locale";

export const LOCALE_KEY = "locale";

/** The language the dashboard last reported, else the browser's own. */
export async function storedLocale(): Promise<SupportedLocale> {
  const stored = await browser.storage.local.get(LOCALE_KEY);
  const value = stored[LOCALE_KEY];
  return isSupportedLocale(value) ? value : localeFromLanguageTags([browser.i18n.getUILanguage()]);
}

export const extensionLocaleHost: LocaleHost = {
  write(locale) {
    void browser.storage.local.set({ [LOCALE_KEY]: locale });
  },
};
