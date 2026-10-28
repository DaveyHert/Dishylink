import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "@core/i18n/resources";
import { readLocale, subscribeToLocale, syncLocaleToHost } from "../lib/locale";

export type { TranslationKey } from "@core/i18n/resources";
export { resources };

void i18n.use(initReactI18next).init({
  resources,
  lng: readLocale(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

function setDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
}

setDocumentLanguage(readLocale());
i18n.on("languageChanged", setDocumentLanguage);

// The host process (desktop main, extension worker) words its own notifications
// and menus, so it is told which language this window settled on — including a
// detected one that was never stored.
syncLocaleToHost(readLocale());
i18n.on("languageChanged", (language) => syncLocaleToHost(language));

// Re-align i18next whenever the user changes the locale setting
subscribeToLocale(() => {
  const next = readLocale();
  if (i18n.language !== next) {
    void i18n.changeLanguage(next);
  }
});

export default i18n;
