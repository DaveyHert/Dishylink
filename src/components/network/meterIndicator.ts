/** How a device's data limit reads at a glance, shared by the network row and the
 *  device detail so one limit never shows two colours in two places. */
import type { MeterRule } from "@core/dataMeter";

export type MeterIndicator = "held" | "reached" | "off" | "watching";

export function meterIndicatorForRule(rule: {
  autoPause: boolean;
  usageBytes: number;
  allocationBytes: number;
  pauseState: MeterRule["pauseState"];
}): MeterIndicator {
  // "held" is the only state that says this rule is what stopped the device. A
  // device paused by hand is blocked too, and reads as whatever its rule is doing.
  if (rule.pauseState === "applied") return "held";
  if (rule.usageBytes >= rule.allocationBytes) return "reached";
  return rule.autoPause ? "watching" : "off";
}

/** Only the states that carry meaning. `watching` is blank so each surface keeps
 *  its own resting tone: white in the device detail, muted in a list row. */
export const METER_INDICATOR_COLOR: Record<MeterIndicator, string> = {
  held: "text-destructive",
  reached: "text-destructive",
  off: "text-ink-secondary opacity-60",
  watching: "",
};
