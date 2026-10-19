// The ranges the bar chart offers, and how a bucket's timestamp is labelled at
// each one. Held apart from the chart so the panels can build their tab strip
// and read labels without importing the chart itself.

import type { TFunction } from "i18next";
import type { EnergyRange } from "../../hooks/useEnergyHistory";

export function rangeTabs(t: TFunction): { label: string; value: EnergyRange }[] {
  return [
    { label: t("ranges.1h"), value: "1h" },
    { label: t("ranges.6h"), value: "6h" },
    { label: t("ranges.12h"), value: "12h" },
    { label: t("ranges.today"), value: "today" },
    { label: t("ranges.day"), value: "day" },
    { label: t("ranges.week"), value: "week" },
    { label: t("ranges.month"), value: "month" },
  ];
}

/** Clock time for sub-day ranges, date for day/week, month name for month. */
export function bucketLabel(epochSeconds: number, range: EnergyRange, locale: string): string {
  const date = new Date(epochSeconds * 1000);
  if (range === "month") return date.toLocaleDateString(locale, { month: "short" }); // Jul
  if (range === "day" || range === "week") {
    return date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  }
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
