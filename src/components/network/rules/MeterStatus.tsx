// One device's limit as it stands. Every figure is the rule's own period and
// allowance, never the Starlink plan's cap, which measures the whole connection
// and is a different thing entirely.

import { Wifi } from "lucide-react";
import { countdownLeftMs } from "@core/dataMeter";
import { scheduleActive } from "@core/schedule";
import type { DataMeter } from "../../../hooks/useDataMeter";
import { useNow } from "../../../hooks/useNow";
import { formatBytes, formatDateTime } from "../../../lib/format";
import { Button } from "../../ui/button";
import { Callout } from "../../ui/callout";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import {
  cycleLabel,
  endsAtLabel,
  endsIn,
  formatDuration,
  ringReading,
  splitDuration,
  timeLeft,
} from "./allowanceTerms";
import { leadingMeasure, meterTone, NEARING_LIMIT, scheduleDormant } from "./ruleMeasure";
import { Bar, RuleStats, Section, Stat } from "./ruleReadout";
import { ScheduleWindows } from "./scheduleFields";

/** The rules covering this device other than the one the card leads with, so a
 *  device held by one of them is never read against an allowance it is nowhere
 *  near. */
function OtherRules({
  meter,
  deviceName,
  nowMs,
}: {
  meter: DataMeter;
  deviceName: string;
  nowMs: number;
}) {
  const others = meter.rules.filter((other) => other !== meter.rule);
  if (others.length === 0) return null;
  return (
    <div className='space-y-1.5'>
      <div className='text-[11px] tracking-wide text-muted-foreground uppercase'>
        Other rules on this device
      </div>
      {others.map((other) => (
        <div
          key={`${other.groupId ?? "own"}:${other.clientKey}`}
          className='flex items-baseline justify-between gap-3 text-[12.5px]'
        >
          <span className='truncate text-muted-foreground'>
            {other.groupName ?? `${deviceName}’s own limit`}
          </span>
          <span className='shrink-0 font-medium tabular-nums text-foreground'>
            {other.countdownMs !== undefined
              ? `${formatDuration(countdownLeftMs(other, nowMs) ?? 0)} left`
              : other.allocationBytes > 0
                ? `${formatBytes(other.usageBytes)} of ${formatBytes(other.allocationBytes)}`
                : // Hours, not an allowance: "of 0 B" reads as a limit of nothing.
                  scheduleActive(other.schedule)
                  ? "On a schedule"
                  : formatBytes(other.usageBytes)}
            {other.holding ? " · holding" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function UsageRing({ spent, paused }: { spent: number; paused: boolean }) {
  const radius = 71;
  const circumference = 2 * Math.PI * radius;
  const stroke =
    paused || spent >= 1
      ? "var(--status-critical)"
      : spent >= NEARING_LIMIT
        ? "var(--accent)"
        : "var(--series-down)";
  return (
    <svg
      width='168'
      height='168'
      viewBox='0 0 168 168'
      aria-hidden='true'
      className='overflow-visible'
    >
      <circle
        cx='84'
        cy='84'
        r={radius}
        fill='none'
        strokeWidth='12'
        stroke='color-mix(in srgb, var(--ink) 12%, transparent)'
      />
      <circle
        cx='84'
        cy='84'
        r={radius}
        fill='none'
        strokeWidth='12'
        strokeLinecap='round'
        stroke={stroke}
        strokeDasharray={`${circumference * spent} ${circumference}`}
        transform='rotate(-90 84 84)'
      />
    </svg>
  );
}

/** Hours and minutes with their units set down in size, so the figure reads as a
 *  number first and the units never crowd it. */
function CountdownReading({ leftMs }: { leftMs: number }) {
  const { hours, minutes } = splitDuration(leftMs);
  return (
    <span className='flex items-baseline gap-1.5 text-[34px] leading-none font-extrabold tabular-nums text-foreground'>
      {hours > 0 && (
        <span className='flex items-baseline'>
          {hours}
          <span className='text-[17px] font-bold'>h</span>
        </span>
      )}
      <span className='flex items-baseline'>
        {minutes}
        <span className='text-[17px] font-bold'>m</span>
      </span>
    </span>
  );
}

export function MeterStatus({
  meter,
  deviceName,
  onEdit,
  onClose,
}: {
  meter: DataMeter;
  deviceName: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  // A countdown is watched as it runs; an allowance only ever reads in hours.
  const nowMs = useNow(meter.rule?.countdownMs === undefined ? 60_000 : 1_000);
  const rule = meter.rule;
  if (!rule) return null;

  const used = rule.usageBytes;
  const allowance = rule.allocationBytes;
  const capped = allowance > 0;
  const remaining = Math.max(0, allowance - used);
  const paused = rule.pauseState === "applied";
  const resets = endsIn(rule.periodEndMs, nowMs);
  const leading = leadingMeasure(rule);
  const timing = leading === "timer";
  const leftMs = countdownLeftMs(rule, nowMs) ?? 0;
  // A countdown fills its ring on the clock; an allowance fills it on what it has
  // spent. Both read as how much of the rule is gone.
  const spent = timing
    ? 1 - leftMs / rule.countdownMs!
    : capped
      ? Math.min(1, used / allowance)
      : 0;
  // A countdown draws its own hours and minutes; only a byte figure is one string.
  const bytesReading = leading === "allowance" ? ringReading(used) : null;

  return (
    <>
      <DialogHeader className='pb-4'>
        <DialogTitle className='text-[19px] leading-snug'>
          {timing ? "Timer" : leading === "schedule" ? "Schedule" : "Data limit"}
        </DialogTitle>
        <DialogDescription className='text-[13px]'>
          {rule.groupName ? `${deviceName} · shared with others` : deviceName}
        </DialogDescription>
        <div className='text-[11.5px] text-muted-foreground'>
          Created {formatDateTime(rule.createdMs)}
        </div>
      </DialogHeader>

      <div className='space-y-5 py-5'>
        {leading === "schedule" ? (
          <div className='space-y-2'>
            <ScheduleWindows schedule={rule.schedule!} />
            {paused && (
              <div className='flex items-center justify-center gap-2 pt-2 text-foreground/60'>
                <Wifi className='size-4.5' strokeWidth={2} />
                <span className='text-[15px] font-semibold tracking-wide'>PAUSED</span>
              </div>
            )}
          </div>
        ) : (
          <div className='relative grid place-items-center'>
            <UsageRing spent={spent} paused={paused} />
            <div className='absolute grid place-items-center text-center'>
              {paused ? (
                <span className='flex flex-col items-center gap-2 text-foreground/60 [animation:paused-pulse_2.4s_ease-in-out_infinite]'>
                  <Wifi className='size-9' strokeWidth={2} />
                  <span className='text-[17px] font-semibold tracking-wide'>PAUSED</span>
                </span>
              ) : (
                <>
                  {bytesReading ? (
                    <span className='text-[34px] leading-none font-extrabold tabular-nums text-foreground'>
                      {bytesReading.value}
                    </span>
                  ) : (
                    <CountdownReading leftMs={leftMs} />
                  )}
                  <span className='mt-1.5 text-[11.5px] tracking-wide text-muted-foreground'>
                    {bytesReading?.unit ?? "LEFT"}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {leading !== "schedule" && (
          <div className='text-center text-[15px] text-muted-foreground'>
            {timing ? (
              <>
                of a{" "}
                <span className='font-semibold text-foreground'>
                  {formatDuration(rule.countdownMs!)}
                </span>{" "}
                timer
              </>
            ) : (
              <>
                of <span className='font-semibold text-foreground'>{formatBytes(allowance)}</span>{" "}
                allowance
              </>
            )}
          </div>
        )}

        {paused && (
          <Callout tone='error'>
            {timing
              ? `${deviceName}’s ${formatDuration(rule.countdownMs!)} timer is up, so its internet is paused until you start it over.`
              : leading === "schedule"
                ? `${deviceName} is outside the hours this rule allows, so its internet is paused.`
                : `${deviceName} reached its ${formatBytes(allowance)} allowance, so its internet is paused${resets ? ` until the cycle ${resets.replace(/^ends/, "resets")}` : ""}.`}
          </Callout>
        )}

        {leading === "schedule" ? (
          <div className='grid grid-cols-2 gap-3 border-t border-border/60 pt-4'>
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
              align='right'
            />
          </div>
        ) : (
          <RuleStats>
            <Stat
              label={timing ? "Time left" : "Remaining"}
              value={timing ? formatDuration(leftMs) : formatBytes(remaining)}
              tone={(timing ? leftMs <= 0 : remaining <= 0) ? "text-destructive" : undefined}
            />
            <Stat
              label={timing ? "Pauses at" : "Resets in"}
              value={
                timing
                  ? leftMs > 0
                    ? endsAtLabel(leftMs, nowMs)
                    : "now"
                  : (timeLeft(rule.periodEndMs, nowMs) ?? "never")
              }
              align='center'
            />
            <Stat
              label={timing ? "Set for" : "Cycle"}
              value={timing ? formatDuration(rule.countdownMs!) : cycleLabel(rule.cycle)}
              align='right'
            />
          </RuleStats>
        )}

        {leading === "schedule" && capped && (
          <Section label='Data allowance'>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-[15px] font-semibold tabular-nums text-foreground'>
                {formatBytes(used)}
              </span>
              <span className='text-[13px] text-muted-foreground'>
                of {formatBytes(allowance)}
                {rule.sharedAllowance ? " shared" : ""} · {cycleLabel(rule.cycle)}
              </span>
            </div>
            <Bar spent={spent} tone={meterTone(spent, paused)} />
          </Section>
        )}

        {(leading === "allowance" || (leading === "schedule" && capped)) && (
          <p className='text-center text-[12px] font-medium text-muted-foreground'>
            Only data used while Dishylink is running is counted.
          </p>
        )}
        {!rule.autoPause && (
          <Callout tone='info'>
            Auto-pause is off, so this {leading} is watched and announced but never enforced.
          </Callout>
        )}
        {rule.pauseState === "failed" && rule.reached && (
          <Callout tone='error'>
            This device reached its limit, but the pause could not be sent to Starlink.
            {rule.pauseError ? ` ${rule.pauseError}.` : ""} It is retried every minute.
          </Callout>
        )}
        {meter.error && <Callout tone='error'>{meter.error}</Callout>}
      </div>

      <div className='space-y-4 border-t border-border/60 pt-4'>
        <OtherRules meter={meter} deviceName={deviceName} nowMs={nowMs} />
        {rule.groupName && (
          <Callout tone='info'>
            This limit covers {rule.groupName}
            {rule.sharedAllowance ? ", which share it between them" : ", each with their own"}.
            Editing it here changes it for all of them.
          </Callout>
        )}
        {rule.autoPause && !paused && !rule.groupName && (
          <Callout tone='info'>
            Device data will automatically pause when usage reaches this limit.
          </Callout>
        )}
        <DialogFooter className='flex-row items-center justify-end gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={onClose}>
            Close
          </Button>
          <Button className='cursor-pointer' onClick={onEdit}>
            Edit limit
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
