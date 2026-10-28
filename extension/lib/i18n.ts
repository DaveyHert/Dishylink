// The service worker's own copy of the catalogs, for the toasts it posts with no
// dashboard open. Re-read on every wake — the worker keeps nothing in memory
// between them — and re-aligned when the dashboard reports a new language.

import { browser } from "wxt/browser";
import type { TFunction } from "i18next";
import { createI18n } from "@core/i18n/resources";
import { isSupportedLocale } from "@core/i18n/locale";
import { LOCALE_KEY, storedLocale } from "./localeHost";

let ready: Promise<TFunction> | null = null;

/** The worker's translator, in the dashboard's language. */
export function workerT(): Promise<TFunction> {
  ready ??= storedLocale().then((locale) => {
    const instance = createI18n(locale);
    browser.storage.onChanged.addListener((changes, area) => {
      const next = changes[LOCALE_KEY]?.newValue;
      if (area === "local" && isSupportedLocale(next)) void instance.changeLanguage(next);
    });
    return instance.t.bind(instance);
  });
  return ready;
}
