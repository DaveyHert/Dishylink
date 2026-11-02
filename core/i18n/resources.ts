// The translation catalogs, and an i18next instance for hosts without React.
//
// The catalogs live in core because the wording is not the renderer's alone:
// the desktop main process posts notifications and builds the tray menu with no
// window open, and the extension's service worker posts toasts between wakes.
// Each host runs its own instance over these same catalogs, so one alert is
// worded identically wherever it reaches the user.

import i18next, { type i18n, type ParseKeys } from "i18next";
import type { SupportedLocale } from "./locale";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import pt from "./locales/pt.json";

export const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
} as const;

/** A key into the catalog, for tables that map a code value to its copy and
 *  resolve it with t() at render time. */
export type TranslationKey = ParseKeys;

/**
 * An instance for a host with no React tree: the desktop main process and the
 * extension worker. Initialised synchronously — the catalogs are inline, so no
 * load is pending — and `t` is usable on return.
 */
export function createI18n(lng: SupportedLocale): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng,
    fallbackLng: "en",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
