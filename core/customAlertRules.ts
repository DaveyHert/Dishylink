// User-defined threshold alert rules.
//
// Built-in alerts fire on the dish's own boolean flags. Custom rules let the
// user fire on numeric telemetry values: "latency above X for Y seconds",
// "download below X Mbps", and so on. They share the same delivery path as
// built-in alerts — the webhook dispatcher and (on desktop) the OS notification
// channel — so a custom rule is indistinguishable at delivery from a system one.
//
// Rules are stored in the collector's data directory. The engine runs in the
// historian so it has access to every fresh sample without an extra poll.

/** Which numeric field the rule watches. */
export type CustomAlertMetric =
  | "downloadMbps"
  | "uploadMbps"
  | "latencyMs"
  | "pingSuccessPercent"
  | "powerWatts"
  | "obstructionPercent";

/** Whether firing requires the value to be above or below the threshold. */
export type CustomAlertCondition = "above" | "below";

/** A user-defined threshold rule, as stored and as evaluated. */
export interface CustomAlertRule {
  /** Stable identifier, UUID-like. Never changes after creation. */
  id: string;
  /** Display name the user typed. */
  name: string;
  metric: CustomAlertMetric;
  condition: CustomAlertCondition;
  /** The numeric threshold value. */
  threshold: number;
  /**
   * How many consecutive seconds the condition must hold before the rule fires.
   * 0 or absent means fire on the first sample that breaches the threshold.
   * Capped at 3600 (one hour) to prevent accidentally-permanent alerts.
   */
  durationSeconds: number;
  /** Whether the rule is currently active. Disabled rules are stored but not
   *  evaluated, so the user can pause one without losing its config. */
  enabled: boolean;
}

/** Minimum and maximum values accepted for each metric, for form validation. */
export const METRIC_BOUNDS: Record<
  CustomAlertMetric,
  { min: number; max: number; step: number; unit: string }
> = {
  downloadMbps: { min: 0, max: 500, step: 1, unit: "Mbps" },
  uploadMbps: { min: 0, max: 200, step: 1, unit: "Mbps" },
  latencyMs: { min: 1, max: 2000, step: 1, unit: "ms" },
  pingSuccessPercent: { min: 0, max: 100, step: 1, unit: "%" },
  powerWatts: { min: 0, max: 200, step: 1, unit: "W" },
  obstructionPercent: { min: 0, max: 100, step: 1, unit: "%" },
};

/** Maximum sustained-condition duration the user may request. */
export const MAX_DURATION_SECONDS = 3600;
