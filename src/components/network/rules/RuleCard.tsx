// One rule in the Rules list, read as whichever of the three things it measures.
// None of the three can be drawn as either of the others without lying about the
// figure.

import { CalendarClock, Gauge, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes } from "../../../lib/format";
import { useNow } from "../../../hooks/useNow";
import type { Rule } from "../../../hooks/useRules";
import { cn } from "@/lib/utils";
import { cycleLabel, formatDuration, timeLeft } from "./allowanceTerms";
import {
  leadingMeasure,
  meterTone,
  NEARING_LIMIT,
  pauseCause,
  scheduleDormant,
  type RuleMeasure,
} from "./ruleMeasure";
import { Bar } from "./ruleReadout";
import { ScheduleWindows } from "./scheduleFields";

/** Keyed to what is actually holding the device, not to what the rule is about:
 *  a rule with a bedtime can still be paused for running out of bytes. */
const PAUSED_BECAUSE: Record<RuleMeasure, string> = {
  schedule: "Paused, outside its schedule",
  timer: "Paused, time is up",
  allowance: "Paused, limit reached",
};

export function RuleCard({
  rule,
  onOpen,
  action,
}: {
  rule: Rule;
  /** Opens the rule's status. Editing is reached from there, or from the menu:
   *  a card is a reading, and clicking a reading should not put it into a form. */
  onOpen: () => void;
  /** The rule's own menu, so the card never decides what can be done to it. */
  action?: ReactNode;
}) {
  const measure = leadingMeasure(rule);
  const nowMs = useNow(measure === "timer" ? 1_000 : 60_000);
  const leftMs =
    rule.countdownMs === undefined
      ? 0
      : Math.max(0, rule.countdownStartMs + rule.countdownMs - nowMs);
  const spent =
    measure === "timer"
      ? 1 - leftMs / (rule.countdownMs || 1)
      : rule.capacityBytes > 0
        ? Math.min(1, rule.usageBytes / rule.capacityBytes)
        : 0;
  // Each device spends its own allowance, so the limit reads as what one device
  // gets and the bar follows the device nearest it — the next one to be paused.
  const perDevice = rule.mode === "perMember" && rule.memberCount > 1;
  // Pooled spends one allowance between them, so the figure and the limit are
  // both the group's and the bar measures the two against each other.
  const shared = rule.mode === "pooled" && rule.memberCount > 1;
  const capped = rule.allocationBytes > 0;
  const dormant = scheduleDormant(rule, nowMs);
  // A rule is only paused when it is holding every device it names. One member
  // out of bytes leaves the rest online, and the rule running.
  const allPaused = rule.pausedCount > 0 && rule.pausedCount === rule.memberCount;
  const capLabel = `${formatBytes(rule.allocationBytes)}${perDevice ? " each" : shared ? " shared" : ""}`;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      className='group relative cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] text-left outline-none [transition:background_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] focus-visible:ring-2 focus-visible:ring-ring/50'
    >
      <div className='space-y-3.5 p-4'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex items-center gap-2.5'>
            <span className='grid size-9 place-items-center rounded-lg bg-surface-raised text-muted-foreground [transition:background_120ms_ease,color_120ms_ease] group-hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface-raised))] group-hover:text-foreground'>
              {measure === "schedule" ? (
                <CalendarClock className='size-4.5' />
              ) : measure === "timer" ? (
                <Timer className='size-4.5' />
              ) : (
                <Gauge className='size-4.5' />
              )}
            </span>
            <span>
              <span className='block text-[15px] font-semibold text-foreground'>{rule.name}</span>
              <span className='block text-[11.5px] text-muted-foreground'>
                {rule.memberKeys.length} device{rule.memberKeys.length === 1 ? "" : "s"}
                {perDevice && capped && <> · {formatBytes(rule.capacityBytes)} in total</>}
              </span>
            </span>
          </div>
          <div onClick={(event) => event.stopPropagation()}>{action}</div>
        </div>

        {measure === "schedule" ? (
          <div className='space-y-1'>
            <ScheduleWindows schedule={rule.schedule!} max={3} compact />
            {/* The hours are the rule's subject, but an allowance riding along
                still decides when it pauses, so the card cannot leave it out. */}
            {capped && (
              <div className='space-y-1.5 pt-1.5'>
                <div className='flex items-baseline justify-between gap-2 text-[12.5px]'>
                  <span className='font-medium tabular-nums text-foreground'>
                    {formatBytes(rule.usageBytes)}
                  </span>
                  <span className='text-muted-foreground'>of {capLabel}</span>
                </div>
                <Bar spent={spent} tone={meterTone(spent, allPaused)} />
              </div>
            )}
          </div>
        ) : measure === "timer" ? (
          <div className='space-y-2'>
            <div className='flex items-baseline justify-between gap-2'>
              <span className='text-[22px] leading-none font-bold tabular-nums text-foreground'>
                {formatDuration(leftMs)}
              </span>
              <span className='text-[12px] text-muted-foreground'>
                of {formatDuration(rule.countdownMs ?? 0)}
              </span>
            </div>
            <Bar
              spent={spent}
              tone={allPaused ? "bg-[var(--status-critical)]" : "bg-[var(--accent)]"}
            />
          </div>
        ) : (
          <div className='space-y-2'>
            <div className='flex items-baseline justify-between gap-2'>
              <span className='text-[22px] leading-none font-bold tabular-nums text-foreground'>
                {formatBytes(rule.usageBytes)}
              </span>
              <span className='text-[12px] text-muted-foreground'>
                {capped ? `Limit: ${capLabel}` : "No cap"}
              </span>
            </div>
            {capped && <Bar spent={spent} tone={meterTone(spent, allPaused)} />}
          </div>
        )}

        <div className='flex items-center justify-between gap-2 text-[12px]'>
          <span
            className={cn(
              "flex items-center gap-1.5",
              allPaused ? "text-[var(--status-critical)]" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                allPaused
                  ? "bg-[var(--status-critical)]"
                  : dormant
                    ? "bg-muted-foreground"
                    : "bg-[var(--status-good)]",
              )}
            />
            {allPaused
              ? PAUSED_BECAUSE[pauseCause(rule)]
              : rule.pausedCount > 0
                ? `Active · ${rule.pausedCount} of ${rule.memberCount} paused`
                : dormant
                  ? "Not scheduled today"
                  : "Active"}
          </span>
          <RuleNote rule={rule} measure={measure} nowMs={nowMs} spent={spent} dormant={dormant} />
        </div>
      </div>
    </div>
  );
}

/** The one figure worth the right-hand corner: what changes next. */
function RuleNote({
  rule,
  measure,
  nowMs,
  spent,
  dormant,
}: {
  rule: Rule;
  measure: RuleMeasure;
  nowMs: number;
  spent: number;
  dormant: boolean;
}) {
  if (measure === "schedule") {
    const turns = rule.windowEndMs ? timeLeft(rule.windowEndMs, nowMs) : null;
    if (!turns) return null;
    return (
      <span className='text-muted-foreground'>
        {dormant ? "Resumes" : rule.windowBlocked ? "Opens" : "Closes"} in {turns}
      </span>
    );
  }
  if (measure === "timer") return null;
  if (rule.allocationBytes > 0 && spent >= NEARING_LIMIT)
    return (
      <span className='rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-2 py-0.5 font-medium text-[var(--accent)]'>
        {Math.round(spent * 100)}% used
      </span>
    );
  const resets = timeLeft(rule.periodEndMs, nowMs);
  return (
    <span className='text-muted-foreground'>
      {resets ? `Resets in ${resets}` : cycleLabel(rule.cycle)}
    </span>
  );
}
