// The main process's own copy of the catalogs. It words the tray menu and the
// notifications the recorder posts with no window open, so it cannot borrow the
// renderer's instance; it follows the language the window reports instead.

import { app } from "electron";
import { createI18n } from "../core/i18n/resources";
import { localeFromLanguageTags, type SupportedLocale } from "../core/i18n/locale";
import { preferences, setPreference } from "./preferences";

function initialLocale(): SupportedLocale {
  return preferences().locale ?? localeFromLanguageTags([app.getLocale()]);
}

const instance = createI18n(initialLocale());

export const t = instance.t.bind(instance);

const listeners = new Set<() => void>();

/** Surfaces that hold translated text (the tray menu) rebuild from here. */
export function onLocaleChanged(listener: () => void): void {
  listeners.add(listener);
}

/** The window reports the language it settled on — a stored choice or a detected
 *  one — and this process follows, remembering it for the next windowless run. */
export function setLocale(locale: SupportedLocale): void {
  if (preferences().locale !== locale) setPreference("locale", locale);
  if (instance.language === locale) return;
  void instance.changeLanguage(locale).then(() => {
    for (const listener of listeners) listener();
  });
}
