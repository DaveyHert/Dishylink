// Clock style preference: the language's own convention, or a forced 12-hour or
// 24-hour clock. Persisted in localStorage like the language, so each app or
// browser keeps its own choice.
//
// Applied through the locale string rather than per call: "en-u-hc-h23" is
// English with a 24-hour clock. Every time display already takes a locale, and
// the hour-cycle extension changes times only, never dates or day names.

export type TimeFormat = "auto" | "12h" | "24h";

export const TIME_FORMATS: readonly TimeFormat[] = ["auto", "12h", "24h"];

export const TIME_FORMAT_STORAGE_KEY = "dishylink-time-format";

const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function isTimeFormat(value: string | null): value is TimeFormat {
  return value === "auto" || value === "12h" || value === "24h";
}

export function readTimeFormat(): TimeFormat {
  if (typeof localStorage === "undefined") return "auto";
  const stored = localStorage.getItem(TIME_FORMAT_STORAGE_KEY);
  return isTimeFormat(stored) ? stored : "auto";
}

export function setTimeFormat(format: TimeFormat): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
  publish();
}

export function subscribeToTimeFormat(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === TIME_FORMAT_STORAGE_KEY) publish();
  });
}

/** The locale to format times with: the language, with the clock forced when
 *  the user chose one. */
export function timeLocale(language: string, format: TimeFormat): string {
  if (format === "12h") return `${language}-u-hc-h12`;
  if (format === "24h") return `${language}-u-hc-h23`;
  return language;
}

/** Whether times read on a 24-hour clock, for the controls that lay out their
 *  own hour fields rather than formatting through a locale. */
export function uses24HourClock(language: string, format: TimeFormat): boolean {
  if (format !== "auto") return format === "24h";
  const hourCycle = new Intl.DateTimeFormat(language, { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  return hourCycle === "h23" || hourCycle === "h24";
}
