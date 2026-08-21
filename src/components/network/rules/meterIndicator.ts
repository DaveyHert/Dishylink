/** How a device's data limit reads at a glance, shared by the network row and the
 *  device detail so one limit never shows two colours in two places. */
import type { PauseState } from "@core/devicePause";

export type MeterIndicator = "held" | "reached" | "off" | "watching";

interface IndicatorRule {
  autoPause: boolean;
  reached: boolean;
  pauseState: PauseState;
  /** Whether this rule is one of the reasons the device is held. The block itself
   *  belongs to the device and says nothing about what caused it. */
  holding: boolean;
}

export function meterIndicatorForRule(rule: IndicatorRule): MeterIndicator {
  // "held" is this rule stopping the device, so it takes both: the router is
  // holding it and this rule is why. A device paused by hand is blocked too, and
  // reads as whatever its rules are doing rather than as one of them.
  if (rule.pauseState === "applied" && rule.holding) return "held";
  // The recorder's answer, not a comparison of the two figures beside it: a timer
  // measures no bytes, and a shared allowance is reached on the group's sum.
  if (rule.reached) return "reached";
  return rule.autoPause ? "watching" : "off";
}

/** The strongest mark of the rules covering one device. A device with a spent
 *  allowance and a schedule still open is over its limit, and a row showing the
 *  gentler of the two would say nothing is wrong. */
const RANK: Record<MeterIndicator, number> = { held: 3, reached: 2, watching: 1, off: 0 };

export function meterIndicatorForDevice(rules: readonly IndicatorRule[]): MeterIndicator | null {
  let strongest: MeterIndicator | null = null;
  for (const rule of rules) {
    const mark = meterIndicatorForRule(rule);
    if (strongest === null || RANK[mark] > RANK[strongest]) strongest = mark;
  }
  return strongest;
}

/** Only the states that carry meaning. `watching` is blank so each surface keeps
 *  its own resting tone: white in the device detail, muted in a list row. */
export const METER_INDICATOR_COLOR: Record<MeterIndicator, string> = {
  held: "text-destructive",
  reached: "text-destructive",
  off: "text-ink-secondary opacity-60",
  watching: "",
};
