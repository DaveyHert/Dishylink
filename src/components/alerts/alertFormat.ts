// Severity vocabulary and the time wording the alert rows use. Pure — the tabs
// all phrase an alert the same way because they read it from here.

import type { AlertSeverity, AlertSource } from "@core/alertDefinitions";

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: "var(--status-critical)",
  warning: "var(--chart-warm)",
  advisory: "var(--ink-muted)",
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  advisory: "Advisory",
};

export function deviceLabel(source: AlertSource): string {
  return source === "dish" ? "Dish" : source === "router" ? "Router" : "System";
}

/** How long an episode ran — the fact history is actually for. */
export function formatSpan(startMs: number, endMs: number): string {
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function relativeTime(atMs: number, nowMs: number = Date.now()): string {
  const deltaS = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (deltaS < 60) return "just now";
  const minutes = Math.round(deltaS / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
