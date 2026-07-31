// Which panes the alerts panel offers, and in what order. Held apart from the
// panes themselves so the menu can list the tabs without importing them.

/** Which pane the menu is showing. */
export type AlertsTab = "active" | "history" | "status";

export const ALERTS_TABS: { key: AlertsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "history", label: "History" },
  { key: "status", label: "Status" },
];
