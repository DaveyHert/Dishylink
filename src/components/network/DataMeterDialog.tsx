// One device's data allowance: what it has spent this cycle, when the cycle
// turns over, and where its internet is cut off.
//
// Every figure here belongs to the rule, not to the account. "Cycle ends in five
// days" is this rule's own period; the bar's full width is the allowance someone
// set for this device. The Starlink plan's own cap covers the whole connection
// and is a different measurement, so it is never the scale on this card.

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { MeterCycle } from "@core/dataMeter";
import type { DataMeter } from "../../hooks/useDataMeter";
import { useNow } from "../../hooks/useNow";
import { formatBytes } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { Callout } from "../ui/callout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SpinLoader } from "../loaders/SpinLoader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const GB = 1_000_000_000;

const CYCLE_OPTIONS: { label: string; value: MeterCycle["kind"] }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Billing cycle", value: "billing" },
  { label: "One-off", value: "once" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "in 5 days" / "tomorrow" / "in 3 hours" — how long this cycle has left. */
function endsIn(endMs: number, nowMs: number): string | null {
  if (!Number.isFinite(endMs)) return null;
  const hours = Math.max(0, Math.round((endMs - nowMs) / 3_600_000));
  if (hours < 1) return "ends within the hour";
  if (hours < 24) return `ends in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ends tomorrow" : `ends in ${days} days`;
}

function cycleFor(
  kind: MeterCycle["kind"],
  weekday: number,
  day: number,
  startedMs: number,
): MeterCycle {
  if (kind === "weekly") return { kind, weekday };
  if (kind === "monthly") return { kind, day };
  if (kind === "custom") return { kind, days: 30, startMs: startedMs };
  return { kind };
}

/** GB as the field shows it: one decimal, and none when it is round. */
function gigabytes(bytes: number): string {
  return (bytes / GB).toFixed(1).replace(/\.0$/, "");
}

const CEILING_RUNGS_GB = [10, 25, 50, 100, 250, 500, 1000];

function ceilingLabel(gigabyteValue: number): string {
  return gigabyteValue >= 1000 ? `${gigabyteValue / 1000} TB` : `${gigabyteValue} GB`;
}

const stepButtonClass =
  "grid h-3 w-6 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-90";

function ceilingFor(gigabyteValue: number): number {
  return CEILING_RUNGS_GB.find((rung) => rung > gigabyteValue) ?? Math.ceil(gigabyteValue);
}

function stepCeiling(current: number, gigabyteValue: number, delta: 1 | -1): number {
  const reachable = CEILING_RUNGS_GB.filter((rung) => rung > gigabyteValue);
  if (reachable.length === 0) return ceilingFor(gigabyteValue);
  const index = reachable.indexOf(current);
  if (index === -1) return reachable[0];
  return reachable[(index + delta + reachable.length) % reachable.length];
}

function clampDay(dayOfMonth: number): number {
  return Math.min(31, Math.max(1, Math.floor(dayOfMonth)));
}

function stepDay(dayOfMonth: number, delta: 1 | -1): number {
  return ((dayOfMonth - 1 + delta + 31) % 31) + 1;
}

function stepFor(ceiling: number): number {
  if (ceiling <= 25) return 0.1;
  if (ceiling <= 100) return 0.5;
  if (ceiling <= 1000) return 5;
  return 25;
}

export function DataMeterDialog({
  meter,
  deviceName,
  open,
  onOpenChange,
}: {
  meter: DataMeter;
  deviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const showForm = editing || (meter.rule === null && !meter.loading);
  const setOpen = (next: boolean) => {
    if (!next) setEditing(false);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className='gap-0 rounded-xl border border-border/50 bg-surface-raised text-ink shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-lg dark:bg-[color-mix(in_srgb,#0e0e0e_80%,transparent)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
        showCloseButton={false}
      >
        {showForm ? (
          <MeterForm
            // The stored rule is the form's opening value, so the form is remounted
            // when a different one arrives rather than being written into by an
            // effect. Keyed on the rule's identity and not its usage, so the poll's
            // fresh figure every ten seconds never discards what is being typed.
            key={meter.rule ? `${meter.rule.clientKey}:${meter.rule.periodStartMs}` : "unset"}
            meter={meter}
            deviceName={deviceName}
            onOpenChange={setOpen}
          />
        ) : meter.rule ? (
          <MeterStatus
            meter={meter}
            deviceName={deviceName}
            onEdit={() => setEditing(true)}
            onClose={() => setOpen(false)}
          />
        ) : (
          <>
            <DialogHeader className='pb-4'>
              <DialogTitle className='text-[19px] leading-snug'>Data limit</DialogTitle>
              <DialogDescription className='text-[13px]'>{deviceName}</DialogDescription>
            </DialogHeader>
            <div className='grid min-h-[220px] place-items-center border-t border-border/60'>
              <SpinLoader size={36} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const NEARING_LIMIT = 0.9;

function UsageRing({ spent, paused }: { spent: number; paused: boolean }) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const stroke =
    paused || spent >= 1
      ? "var(--status-critical)"
      : spent >= NEARING_LIMIT
        ? "var(--accent)"
        : "var(--series-down)";
  return (
    <svg width='160' height='160' viewBox='0 0 160 160' aria-hidden='true'>
      <circle
        cx='80'
        cy='80'
        r={radius}
        fill='none'
        strokeWidth='12'
        stroke='color-mix(in srgb, var(--ink) 12%, transparent)'
      />
      <circle
        cx='80'
        cy='80'
        r={radius}
        fill='none'
        strokeWidth='12'
        strokeLinecap='round'
        stroke={stroke}
        strokeDasharray={`${circumference * spent} ${circumference}`}
        transform='rotate(-90 80 80)'
      />
    </svg>
  );
}

function MeterStatus({
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
  const nowMs = useNow(60_000);
  const rule = meter.rule;
  if (!rule) return null;

  const used = rule.usageBytes;
  const allowance = rule.allocationBytes;
  const remaining = Math.max(0, allowance - used);
  const spent = allowance > 0 ? Math.min(1, used / allowance) : 0;
  const paused = rule.pauseState === "applied";
  const resets = endsIn(rule.periodEndMs, nowMs);

  return (
    <>
      <DialogHeader className='pb-4'>
        <DialogTitle className='text-[19px] leading-snug'>Data limit</DialogTitle>
        <DialogDescription className='text-[13px]'>{deviceName}</DialogDescription>
      </DialogHeader>

      <div className='space-y-5 py-5'>
        <div className='relative grid place-items-center'>
          <UsageRing spent={spent} paused={paused} />
          <div className='absolute grid place-items-center text-center'>
            {paused ? (
              <span className='text-[17px] font-semibold tracking-wide text-destructive'>
                PAUSED
              </span>
            ) : (
              <>
                <span className='text-[34px] leading-none font-extrabold tabular-nums text-foreground'>
                  {gigabytes(used)}
                </span>
                <span className='mt-1 text-[11px] tracking-wide text-muted-foreground'>
                  GB USED
                </span>
              </>
            )}
          </div>
        </div>
        <div className='text-center text-[13px] text-muted-foreground'>
          of <span className='font-semibold text-foreground'>{formatBytes(allowance)}</span>{" "}
          allowance
        </div>

        {paused && (
          <Callout tone='error'>
            {deviceName} reached its {formatBytes(allowance)} allowance, so its internet is paused
            {resets ? ` until the cycle ${resets.replace(/^ends/, "resets")}` : ""}.
          </Callout>
        )}

        <div className='grid grid-cols-2 gap-3 border-t border-border/60 pt-4'>
          <div>
            <div className='text-[12px] text-muted-foreground'>Remaining</div>
            <div
              className={`text-[17px] font-semibold tabular-nums ${remaining <= 0 ? "text-destructive" : "text-foreground"}`}
            >
              {formatBytes(remaining)}
            </div>
          </div>
          <div className='text-right'>
            <div className='text-[12px] text-muted-foreground'>Cycle</div>
            <div className='text-[17px] font-semibold text-foreground'>
              {resets ? resets.replace(/^ends /, "") : "no reset"}
            </div>
          </div>
        </div>

        {!rule.autoPause && (
          <Callout tone='info'>
            Auto-pause is off, so this allowance is watched and announced but never enforced.
          </Callout>
        )}
        {rule.pauseState === "failed" && (
          <Callout tone='error'>
            This device reached its limit, but the pause could not be sent to Starlink.
          </Callout>
        )}
        {meter.error && <Callout tone='error'>{meter.error}</Callout>}
      </div>

      <DialogFooter className='flex-row items-center justify-end gap-2 border-t border-border/60 pt-4'>
        <Button variant='outline' className='cursor-pointer' onClick={onClose}>
          Close
        </Button>
        <Button className='cursor-pointer' onClick={onEdit}>
          Edit limit
        </Button>
      </DialogFooter>
    </>
  );
}

function MeterForm({
  meter,
  deviceName,
  onOpenChange,
}: {
  meter: DataMeter;
  deviceName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { rule, pauseEnforceable, error, save, restart, remove } = meter;
  const [allocationGB, setAllocationGB] = useState(rule ? gigabytes(rule.allocationBytes) : "50");
  const [ceiling, setCeiling] = useState(() => ceilingFor(rule ? rule.allocationBytes / GB : 50));
  const [autoPause, setAutoPause] = useState(rule?.autoPause ?? true);
  const [kind, setKind] = useState<MeterCycle["kind"]>(rule?.cycle.kind ?? "monthly");
  const [weekday, setWeekday] = useState(rule?.cycle.kind === "weekly" ? rule.cycle.weekday : 1);
  const [dayText, setDayText] = useState(
    rule?.cycle.kind === "monthly" ? String(rule.cycle.day) : "1",
  );
  const [busy, setBusy] = useState(false);
  // The countdown moves whether or not anything re-renders, and only ever reads
  // in hours, so a slow tick is enough.
  const nowMs = useNow(60_000);

  const day = clampDay(Number(dayText) || 1);
  const allocationBytes = Math.max(0, Number(allocationGB) || 0) * GB;
  const used = rule?.usageBytes ?? 0;
  const remaining = allocationBytes - used;
  const spent = allocationBytes > 0 ? Math.min(1, used / allocationBytes) : 0;
  const willPauseOnSave =
    autoPause && rule !== null && allocationBytes > 0 && used >= allocationBytes;

  const apply = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className='pb-4'>
        <DialogTitle className='text-[19px] leading-snug'>Data limit</DialogTitle>
        <DialogDescription className='text-[13px]'>
          Pause “{deviceName}” once it has used its share.
        </DialogDescription>
      </DialogHeader>

      <div className='space-y-5 border-t border-border/60 py-5'>
        <div>
          <div className='flex items-baseline justify-between'>
            <span className='text-[13px] font-medium text-foreground'>This cycle</span>
            <span className='text-[13px] tabular-nums text-muted-foreground'>
              <span
                className={`font-semibold ${remaining <= 0 ? "text-destructive" : "text-foreground"}`}
              >
                {formatBytes(used)}
              </span>
              {allocationBytes > 0 && <> / {formatBytes(allocationBytes)}</>}
            </span>
          </div>
          <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'>
            <div
              className={`h-full rounded-full ${spent >= 1 ? "bg-destructive" : "bg-[color-mix(in_srgb,var(--ink)_78%,var(--baseline))]"}`}
              style={{ width: `${spent * 100}%` }}
            />
          </div>
          <div className='mt-1.5 flex justify-between text-[11.5px] text-muted-foreground'>
            <span>
              {rule
                ? (endsIn(rule.periodEndMs, nowMs) ?? "Does not reset on its own")
                : "No limit set yet"}
            </span>
            {rule && allocationBytes > 0 && (
              <span className={remaining <= 0 ? "text-destructive" : undefined}>
                {formatBytes(Math.max(0, remaining))} left
              </span>
            )}
          </div>
        </div>

        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='text-[13px] font-medium text-foreground'>Auto-pause data</div>
            <div className='text-[12px] text-muted-foreground'>
              Cuts this device’s internet until the cycle turns over.
            </div>
          </div>
          <Switch checked={autoPause} onCheckedChange={setAutoPause} />
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <label className='space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Allowance</span>
            <div className='relative'>
              <Input
                value={allocationGB}
                inputMode='decimal'
                onChange={(event) => {
                  setAllocationGB(event.target.value);
                  const typed = Number(event.target.value);
                  if (Number.isFinite(typed) && typed > ceiling) setCeiling(ceilingFor(typed));
                }}
                className='pr-12 tabular-nums'
              />
              <span className='absolute inset-y-0 right-3 flex items-center text-[12px] text-muted-foreground'>
                GB
              </span>
            </div>
          </label>
          <div className='space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets</span>
            <Select value={kind} onValueChange={(next) => setKind(next as MeterCycle["kind"])}>
              <SelectTrigger className='w-full text-[13px]' aria-label='Resets'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CYCLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='flex items-center gap-3'>
          <Slider
            value={[Math.min(Number(allocationGB) || 0, ceiling)]}
            max={ceiling}
            step={stepFor(ceiling)}
            onValueChange={([next]) => setAllocationGB(String(next))}
            aria-label='Allowance in gigabytes'
          />
          <div className='flex shrink-0 flex-col items-center gap-0.5'>
            <button
              type='button'
              onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationGB) || 0, 1))}
              aria-label='Extend the slider'
              className={stepButtonClass}
            >
              <ChevronUpIcon className='size-3' />
            </button>
            <button
              type='button'
              onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationGB) || 0, 1))}
              title='Change how far the slider reaches'
              className='cursor-pointer rounded-sm px-1 text-[11.5px] leading-none tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              {ceilingLabel(ceiling)}
            </button>
            <button
              type='button'
              onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationGB) || 0, -1))}
              aria-label='Shorten the slider'
              className={stepButtonClass}
            >
              <ChevronDownIcon className='size-3' />
            </button>
          </div>
        </div>

        {kind === "weekly" && (
          <div className='space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets on</span>
            <Select value={String(weekday)} onValueChange={(next) => setWeekday(Number(next))}>
              <SelectTrigger className='w-full text-[13px]' aria-label='Resets on'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((label, index) => (
                  <SelectItem key={label} value={String(index)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {kind === "monthly" && (
          <label className='block space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets on day</span>
            <div className='relative'>
              <Input
                value={dayText}
                inputMode='numeric'
                onChange={(event) => setDayText(event.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => setDayText(String(day))}
                className='pr-9 tabular-nums'
              />
              <div className='absolute inset-y-0 right-2 flex flex-col justify-center gap-0.5'>
                <button
                  type='button'
                  onClick={() => setDayText(String(stepDay(day, 1)))}
                  aria-label='Later in the month'
                  className={stepButtonClass}
                >
                  <ChevronUpIcon className='size-3' />
                </button>
                <button
                  type='button'
                  onClick={() => setDayText(String(stepDay(day, -1)))}
                  aria-label='Earlier in the month'
                  className={stepButtonClass}
                >
                  <ChevronDownIcon className='size-3' />
                </button>
              </div>
            </div>
          </label>
        )}

        {willPauseOnSave && (
          <Callout tone='error'>
            This device has already used more than that, so saving pauses it straight away.
          </Callout>
        )}
        {autoPause &&
          (pauseEnforceable ? (
            <Callout tone='info'>
              Auto-pausing requires your Starlink account to be signed in. It works whether or not
              this computer is on the same network as the router.
            </Callout>
          ) : (
            <Callout tone='error'>
              Connect your Starlink account for Dishylink to pause a device on its own. Until then
              the limit is watched and announced, but nothing is paused.
            </Callout>
          ))}
        {rule?.pauseState === "failed" && (
          <Callout tone='error'>
            This device reached its limit, but the pause could not be sent to Starlink.
          </Callout>
        )}
        {error && <Callout tone='error'>{error}</Callout>}
      </div>

      <DialogFooter className='flex-row items-center justify-between gap-2 border-t border-border/60 pt-4 sm:justify-between'>
        <div className='flex gap-2'>
          {rule && (
            <>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer'
                disabled={busy}
                onClick={() => void apply(restart)}
              >
                Start over
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer text-destructive hover:text-destructive'
                disabled={busy}
                onClick={() =>
                  void apply(async () => {
                    await remove();
                    onOpenChange(false);
                  })
                }
              >
                Remove
              </Button>
            </>
          )}
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className='cursor-pointer'
            disabled={busy || allocationBytes <= 0}
            onClick={() =>
              void apply(async () => {
                await save({
                  allocationBytes,
                  autoPause,
                  cycle: cycleFor(kind, weekday, day, nowMs),
                });
                onOpenChange(false);
              })
            }
          >
            Save limit
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
