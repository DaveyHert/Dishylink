// What a rule is doing right now, before anyone offers to change it. Each-mode
// draws a bar per device rather than one figure: a sum across devices that each
// carry the whole allowance is measured against nothing.

import { CalendarClock, Gauge, Timer, Wifi } from "lucide-react";
import { classifyDevice } from "../../../lib/deviceKind";
import { formatBytes, formatDateTime } from "../../../lib/format";
import { vendorForMac } from "../../../lib/macVendor";
import { DeviceTypeIcon } from "../../../assets/icons/DeviceTypeIcon";
import { useNow } from "../../../hooks/useNow";
import type { Rule, RuleMember } from "../../../hooks/useRules";
import { Button } from "../../ui/button";
import { Callout } from "../../ui/callout";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "../../ui/dialog";
import type { MemberCandidate } from "./allowanceTerms";
import { cycleLabel, endsAtLabel, formatDuration, timeLeft } from "./allowanceTerms";
import { leadingMeasure, meterTone, scheduleDormant } from "./ruleMeasure";
import { Bar, RuleStats, Section, Stat } from "./ruleReadout";
import { ScheduleWindows } from "./scheduleFields";

/** Device-type icon plus vendor, as the Network tab draws a device — a rule's
 *  own record carries no MAC, so this reads it off the candidate roster instead. */
function MemberIdentity({ member, macAddress }: { member: RuleMember; macAddress?: string }) {
  const vendor = vendorForMac(macAddress);
  return (
    <span className='flex min-w-0 flex-col gap-px'>
      <span className='flex min-w-0 items-center gap-1.5'>
        {member.paused && <Wifi className='size-3.5 shrink-0 text-[var(--status-critical)]' />}
        <DeviceTypeIcon
          kind={classifyDevice(member.name)}
          size={13}
          className='shrink-0 text-ink-secondary'
        />
        <span className='truncate font-medium text-foreground'>{member.name}</span>
      </span>
      {vendor && (
        <span className='truncate pl-[19px] text-[11px] text-muted-foreground'>{vendor}</span>
      )}
    </span>
  );
}

/** One device against the allowance it has to itself. */
function MemberMeter({
  member,
  allocationBytes,
  macAddress,
}: {
  member: RuleMember;
  allocationBytes: number;
  macAddress?: string;
}) {
  const spent = allocationBytes > 0 ? member.usageBytes / allocationBytes : 0;
  return (
    <div className='space-y-1.5'>
      <div className='flex items-baseline justify-between gap-3 text-[13px]'>
        <MemberIdentity member={member} macAddress={macAddress} />
        <span className='shrink-0 tabular-nums text-muted-foreground'>
          {formatBytes(member.usageBytes)}
          {allocationBytes > 0 && <> · {Math.round(Math.min(1, spent) * 100)}%</>}
        </span>
      </div>
      {allocationBytes > 0 && <Bar spent={spent} tone={meterTone(spent, member.paused)} />}
    </div>
  );
}

export function RuleStatus({
  rule,
  candidates,
  onEdit,
  onClose,
}: {
  rule: Rule;
  /** The same roster the picker draws from, read here only for each member's
   *  MAC — a rule's own record never carries one. */
  candidates: MemberCandidate[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const macByKey = new Map(
    candidates.map((candidate) => [candidate.clientKey, candidate.macAddress]),
  );
  const leading = leadingMeasure(rule);
  const timing = leading === "timer";
  const nowMs = useNow(timing ? 1_000 : 60_000);
  const leftMs = timing ? Math.max(0, rule.countdownStartMs + rule.countdownMs! - nowMs) : 0;
  const capped = rule.allocationBytes > 0;
  const pooled = rule.mode === "pooled" && rule.memberCount > 1;
  // One device out of bytes is not the whole rule stopping, so the headline bar
  // stays on its own figure rather than reddening for a member.
  const allPaused = rule.pausedCount > 0 && rule.pausedCount === rule.memberCount;
  // Every device carries the whole allowance, so each is read on its own.
  const perDevice = rule.mode === "perMember" && rule.memberCount > 1 && capped;
  // Pooled reads as one meter; a lone device is the same shape with one member.
  const oneMeter = !perDevice && capped;
  const spent = capped ? Math.min(1, rule.usageBytes / rule.allocationBytes) : 0;
  const held = rule.members.filter((member) => member.holding);

  return (
    <>
      <DialogHeader className='pb-4'>
        <div className='flex items-start gap-2.5'>
          <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-surface-raised text-muted-foreground'>
            {leading === "timer" ? (
              <Timer className='size-4.5' />
            ) : leading === "schedule" ? (
              <CalendarClock className='size-4.5' />
            ) : (
              <Gauge className='size-4.5' />
            )}
          </span>
          <div className='space-y-0.5'>
            <DialogTitle className='text-[19px] leading-snug'>{rule.name}</DialogTitle>
            <DialogDescription className='text-[13px]'>
              {rule.memberKeys.length} device{rule.memberKeys.length === 1 ? "" : "s"}
              {capped && pooled
                ? " · sharing one allowance"
                : capped && perDevice
                  ? " · one allowance each"
                  : ""}
            </DialogDescription>
            <div className='text-[11.5px] text-muted-foreground'>
              Created {formatDateTime(rule.createdMs)}
            </div>
          </div>
        </div>
      </DialogHeader>

      <div className='space-y-5 py-5'>
        {leading === "timer" ? (
          <div className='space-y-2 border-t border-border/60 pt-5'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-[30px] leading-none font-bold tabular-nums text-foreground'>
                {formatDuration(leftMs)}
              </span>
              <span className='text-[13px] text-muted-foreground'>
                of {formatDuration(rule.countdownMs!)}
              </span>
            </div>
            <Bar
              spent={1 - leftMs / (rule.countdownMs || 1)}
              tone={allPaused ? "bg-[var(--status-critical)]" : "bg-[var(--accent)]"}
            />
          </div>
        ) : leading === "schedule" ? (
          <div className='space-y-2 border-t border-border/60 pt-5'>
            <ScheduleWindows schedule={rule.schedule!} />
          </div>
        ) : oneMeter ? (
          <div className='space-y-2 border-t border-border/60 pt-5'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-[30px] leading-none font-bold tabular-nums text-foreground'>
                {formatBytes(rule.usageBytes)}
              </span>
              <span className='text-[13px] text-muted-foreground'>
                of {formatBytes(rule.allocationBytes)}
                {pooled ? " shared" : ""}
              </span>
            </div>
            <Bar spent={spent} tone={meterTone(spent, allPaused)} />
          </div>
        ) : null}

        {rule.paused && held.length > 0 && (
          <Callout tone='error'>
            {held.length === rule.memberCount && rule.memberCount > 1
              ? "Every device on this rule is paused"
              : `${held.map((member) => member.name).join(", ")} ${held.length === 1 ? "is" : "are"} paused`}
            {rule.windowBlocked
              ? " because it is outside the hours this rule allows."
              : timing
                ? " because the timer is up."
                : " because the limit was reached."}
          </Callout>
        )}

        {leading === "timer" ? (
          <RuleStats>
            <Stat
              label='Time left'
              value={formatDuration(leftMs)}
              tone={leftMs <= 0 ? "text-destructive" : undefined}
            />
            <Stat label='Pauses at' value={leftMs > 0 ? endsAtLabel(leftMs, nowMs) : "now"} />
            <Stat label='Set for' value={formatDuration(rule.countdownMs!)} />
          </RuleStats>
        ) : leading === "schedule" ? (
          <RuleStats>
            <Stat
              label={
                scheduleDormant(rule, nowMs)
                  ? "Resumes in"
                  : rule.windowBlocked
                    ? "Opens in"
                    : "Closes in"
              }
              value={rule.windowEndMs ? (timeLeft(rule.windowEndMs, nowMs) ?? "—") : "—"}
            />
            <Stat
              label='Right now'
              value={
                scheduleDormant(rule, nowMs)
                  ? "Not scheduled"
                  : rule.windowBlocked
                    ? "Paused"
                    : "Online"
              }
            />
            <Stat
              label='Devices'
              value={`${rule.memberKeys.length} device${rule.memberKeys.length === 1 ? "" : "s"}`}
            />
          </RuleStats>
        ) : (
          capped && (
            <RuleStats>
              <Stat
                label={perDevice ? "Allowance" : "Remaining"}
                value={
                  perDevice
                    ? `${formatBytes(rule.allocationBytes)} each`
                    : formatBytes(Math.max(0, rule.allocationBytes - rule.usageBytes))
                }
                tone={
                  !perDevice && rule.usageBytes >= rule.allocationBytes
                    ? "text-destructive"
                    : undefined
                }
              />
              <Stat label='Resets in' value={timeLeft(rule.periodEndMs, nowMs) ?? "never"} />
              <Stat label='Cycle' value={cycleLabel(rule.cycle)} />
            </RuleStats>
          )
        )}

        {/* A rule that leads with its hours can still carry an allowance, and one
            that leads with a timer never does. */}
        {leading === "schedule" && capped && (
          <Section label='Data allowance'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-[15px] font-semibold tabular-nums text-foreground'>
                {formatBytes(rule.usageBytes)}
              </span>
              <span className='text-[13px] text-muted-foreground'>
                of {formatBytes(rule.allocationBytes)}
                {perDevice ? " each" : pooled ? " shared" : ""} · {cycleLabel(rule.cycle)}
              </span>
            </div>
            {!perDevice && <Bar spent={spent} tone={meterTone(spent, rule.paused)} />}
          </Section>
        )}

        {perDevice ? (
          <Section label='Devices'>
            <div className='space-y-3'>
              {rule.members.map((member) => (
                <MemberMeter
                  key={member.clientKey}
                  member={member}
                  allocationBytes={rule.allocationBytes}
                  macAddress={macByKey.get(member.clientKey)}
                />
              ))}
            </div>
          </Section>
        ) : (
          (leading === "schedule" || rule.memberCount > 1) && (
            <Section label='Devices'>
              <div className='space-y-1'>
                {rule.members.map((member) => (
                  <div
                    key={member.clientKey}
                    className='flex items-baseline justify-between gap-3 text-[13px]'
                  >
                    <MemberIdentity member={member} macAddress={macByKey.get(member.clientKey)} />
                    <span className='shrink-0 tabular-nums text-muted-foreground'>
                      {formatBytes(member.usageBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )
        )}

        {!rule.autoPause && (
          <Callout tone='info'>
            Auto-pause is off, so this rule is watched and announced but nothing is paused.
          </Callout>
        )}
      </div>

      <DialogFooter className='flex-row items-center justify-end gap-2 border-t border-border/60 pt-4'>
        <Button variant='outline' className='cursor-pointer' onClick={onClose}>
          Close
        </Button>
        <Button className='cursor-pointer' onClick={onEdit}>
          Edit rule
        </Button>
      </DialogFooter>
    </>
  );
}
