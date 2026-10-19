// Which interface languages exist, and how a host's language tags map onto one.
// Shared by every host that holds a catalog: the renderer reads navigator, the
// desktop main process reads Electron's app locale, the extension worker reads
// the browser's UI language. One rule, so they all land on the same answer.

export type SupportedLocale = "en" | "es" | "fr" | "de" | "pt";

export const SUPPORTED_LOCALE_CODES: readonly SupportedLocale[] = ["en", "es", "fr", "de", "pt"];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(locale: unknown): locale is SupportedLocale {
  return (
    typeof locale === "string" && (SUPPORTED_LOCALE_CODES as readonly string[]).includes(locale)
  );
}

/** The first supported language in a preference-ordered list of BCP 47 tags
 *  ("pt-BR", "nl-NL", …), or English when none of them is. */
export function localeFromLanguageTags(tags: readonly (string | undefined)[]): SupportedLocale {
  for (const tag of tags) {
    const language = tag?.split("-")[0]?.toLowerCase();
    if (language && isSupportedLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}
