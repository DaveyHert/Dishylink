// Which panes the alerts panel offers, and in what order. Held apart from the
// panes themselves so the menu can list the tabs without importing them.

import type { TranslationKey } from "@core/i18n/resources";

/** Which pane the menu is showing. */
export type AlertsTab = "active" | "history" | "status";

export const ALERTS_TABS: { key: AlertsTab; label: TranslationKey }[] = [
  { key: "active", label: "alerts.tabActive" },
  { key: "history", label: "alerts.tabHistory" },
  { key: "status", label: "alerts.tabStatus" },
];
