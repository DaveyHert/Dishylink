// Severity vocabulary and the time wording the alert rows use. Pure — the tabs
// all phrase an alert the same way because they read it from here.

import type { TFunction } from "i18next";
import type { AlertSeverity, AlertSource } from "@core/alertDefinitions";
import type { TranslationKey } from "@core/i18n/resources";

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: "var(--status-critical)",
  warning: "var(--chart-warm)",
  advisory: "var(--ink-muted)",
};

export const SEVERITY_LABEL: Record<AlertSeverity, TranslationKey> = {
  critical: "alerts.severityCritical",
  warning: "alerts.severityWarning",
  advisory: "alerts.severityAdvisory",
};

export function deviceLabel(source: AlertSource, t: TFunction): string {
  return source === "dish"
    ? t("alerts.deviceDish")
    : source === "router"
      ? t("alerts.deviceRouter")
      : t("alerts.deviceSystem");
}

/** How long an episode ran — the fact history is actually for. */
export function formatSpan(startMs: number, endMs: number, t: TFunction): string {
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return t("time.spanSeconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("time.spanMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t("time.spanHoursMinutes", { hours, minutes: minutes % 60 });
}

export function relativeTime(atMs: number, t: TFunction, nowMs: number = Date.now()): string {
  const deltaS = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (deltaS < 60) return t("time.justNow");
  const minutes = Math.round(deltaS / 60);
  if (minutes < 60) return t("time.shortMinutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("time.shortHoursAgo", { count: hours });
  return t("time.shortDaysAgo", { count: Math.round(hours / 24) });
}
