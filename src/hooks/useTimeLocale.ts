import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  readTimeFormat,
  subscribeToTimeFormat,
  timeLocale,
  uses24HourClock,
} from "../lib/timeFormat";

/** The locale every time display formats with: the interface language, with
 *  the clock style from Settings › App. */
export function useTimeLocale(): string {
  const { i18n } = useTranslation();
  const format = useSyncExternalStore(subscribeToTimeFormat, readTimeFormat);
  return timeLocale(i18n.language, format);
}

/** True when hour fields should run 0–23 with no AM/PM. */
export function use24HourClock(): boolean {
  const { i18n } = useTranslation();
  const format = useSyncExternalStore(subscribeToTimeFormat, readTimeFormat);
  return uses24HourClock(i18n.language, format);
}
