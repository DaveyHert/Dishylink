// Interface display language preferences. Follows the same pattern as
// toolbarStyle and theme: persisted in localStorage under dishylink-locale,
// initialized from browser settings if not explicitly chosen, and subscribed
// across UI components.

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  localeFromLanguageTags,
  type SupportedLocale,
} from "@core/i18n/locale";

export { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale };

export interface LocaleOption {
  code: SupportedLocale;
  label: string;
  nativeLabel: string;
}

export const SUPPORTED_LOCALES: readonly LocaleOption[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
] as const;

export const LOCALE_STORAGE_KEY = "dishylink-locale";

const listeners = new Set<() => void>();

function publishLocaleChange(): void {
  for (const listener of listeners) listener();
}

// The browser's languages in preference order, so a second choice we do have
// beats falling to English when the first is one we don't.
function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return localeFromLanguageTags(preferred);
}

export function readLocale(): SupportedLocale {
  if (typeof localStorage === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && isSupportedLocale(stored)) {
    return stored;
  }
  return detectBrowserLocale();
}

export function setLocale(locale: SupportedLocale): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  publishLocaleChange();
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keep multiple Dishylink windows in step. The window that performs the write
// is notified by setLocale; every other window receives the storage event.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY) publishLocaleChange();
  });
}

/** A host process that words its own notifications and menus — desktop main,
 *  the extension worker — and so needs to be told the language this window
 *  settled on. Absent in a plain browser tab, where there is no such process. */
export interface LocaleHost {
  write: (locale: SupportedLocale) => void;
}

let host: LocaleHost | null = null;

/** Called once by a host entry point. The current language is pushed at once,
 *  so a host bound after i18n initialised still learns a detected locale. */
export function setLocaleHost(binding: LocaleHost): void {
  host = binding;
  binding.write(readLocale());
}

export function syncLocaleToHost(locale: string): void {
  if (host && isSupportedLocale(locale)) host.write(locale);
}
