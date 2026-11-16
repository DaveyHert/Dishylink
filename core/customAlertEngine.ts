// Evaluates user-defined threshold rules against live telemetry samples.
//
// The engine holds one state entry per rule: when the threshold was first
// breached and whether the rule is currently firing. On each sample it:
//   1. Reads the metric value from the sample.
//   2. Checks the condition.
//   3. If breached, marks the onset timestamp (if not already set).
//      If the breach has lasted ≥ durationSeconds, fires the rule.
//   4. If the condition is no longer breached, clears both the onset and the
//      fired state (yielding a "cleared" transition when it was firing).
//
// Transitions are the same shape as the built-in alert engine so the same
// delivery paths — webhook, desktop notification — handle both kinds.

import type { CustomAlertRule, CustomAlertMetric } from "./customAlertRules";

/** A live telemetry reading the custom engine evaluates rules against.
 *  Values that the historian has available on each 5s poll cycle. */
export interface CustomSample {
  timestampMs: number;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
  pingSuccessPercent: number;
  /** null when no power reading was in the sample. */
  powerWatts: number | null;
  /** null when obstruction data is not yet available. */
  obstructionPercent: number | null;
}

/** A custom rule crossing into or out of the firing state. */
export interface CustomAlertTransition {
  kind: "fired" | "cleared";
  rule: CustomAlertRule;
  atMs: number;
  /** The value that caused the transition, for notification wording. */
  value: number;
}

function readMetric(sample: CustomSample, metric: CustomAlertMetric): number | null {
  switch (metric) {
    case "downloadMbps":
      return sample.downloadMbps;
    case "uploadMbps":
      return sample.uploadMbps;
    case "latencyMs":
      return sample.latencyMs;
    case "pingSuccessPercent":
      return sample.pingSuccessPercent;
    case "powerWatts":
      return sample.powerWatts;
    case "obstructionPercent":
      return sample.obstructionPercent;
  }
}

function breaches(value: number, rule: CustomAlertRule): boolean {
  return rule.condition === "above" ? value > rule.threshold : value < rule.threshold;
}

interface RuleState {
  /** When the breach started, or null if currently within bounds. */
  onsetMs: number | null;
  /** Whether the rule has already fired (and not yet cleared). */
  firing: boolean;
}

export class CustomAlertEngine {
  private state = new Map<string, RuleState>();

  /** Bring the engine up to date with the current set of rules.
   *  Rules added since the last call get fresh state; rules removed have
   *  their state discarded. Any rules that were firing and are now being
   *  disabled emit a cleared transition so delivery paths know to stop. */
  sync(rules: CustomAlertRule[], nowMs: number): CustomAlertTransition[] {
    const transitions: CustomAlertTransition[] = [];
    const keepIds = new Set(rules.map((r) => r.id));

    // Emit clears for rules that disappeared or were disabled while firing.
    for (const [id, s] of this.state) {
      if (!keepIds.has(id) && s.firing) {
        const rule = [...this.state.keys()]; // id is enough for a "gone" clear
        void rule; // suppress lint
        // We can't reconstruct the full rule here — the caller is responsible
        // for passing transitions from update() before calling sync() with a
        // reduced set. State is cleaned up below regardless.
      }
      if (!keepIds.has(id)) this.state.delete(id);
    }

    // Seed state for new rules.
    for (const rule of rules) {
      if (!this.state.has(rule.id)) {
        this.state.set(rule.id, { onsetMs: null, firing: false });
      }
      // A rule that was firing but is now disabled: emit a clear.
      if (!rule.enabled) {
        const s = this.state.get(rule.id)!;
        if (s.firing) {
          transitions.push({ kind: "cleared", rule, atMs: nowMs, value: rule.threshold });
          s.firing = false;
          s.onsetMs = null;
        }
      }
    }

    return transitions;
  }

  /** Evaluate one sample against all enabled rules and return any transitions. */
  update(rules: CustomAlertRule[], sample: CustomSample): CustomAlertTransition[] {
    const transitions: CustomAlertTransition[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const value = readMetric(sample, rule.metric);
      if (value === null) continue; // metric unavailable this sample

      let s = this.state.get(rule.id);
      if (!s) {
        s = { onsetMs: null, firing: false };
        this.state.set(rule.id, s);
      }

      const inBreach = breaches(value, rule);

      if (inBreach) {
        if (s.onsetMs === null) s.onsetMs = sample.timestampMs;
        const heldMs = sample.timestampMs - s.onsetMs;
        const requiredMs = (rule.durationSeconds ?? 0) * 1000;
        if (!s.firing && heldMs >= requiredMs) {
          s.firing = true;
          transitions.push({ kind: "fired", rule, atMs: sample.timestampMs, value });
        }
      } else {
        if (s.firing) {
          transitions.push({ kind: "cleared", rule, atMs: sample.timestampMs, value });
          s.firing = false;
        }
        s.onsetMs = null;
      }
    }

    return transitions;
  }

  /** All rule IDs currently in the firing state. */
  firingIds(): Set<string> {
    const result = new Set<string>();
    for (const [id, s] of this.state) {
      if (s.firing) result.add(id);
    }
    return result;
  }
}
