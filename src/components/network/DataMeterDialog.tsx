// One device's data allowance: what it has spent this cycle, when the cycle
// turns over, and where its internet is cut off.
//
// Every figure here belongs to the rule, not to the account. "Cycle ends in five
// days" is this rule's own period; the bar's full width is the allowance someone
// set for this device. The Starlink plan's own cap covers the whole connection
// and is a different measurement, so it is never the scale on this card.

import { useState } from "react";
import type { MeterCycle } from "@core/dataMeter";
import { useDataMeter } from "../../hooks/useDataMeter";
import { useNow } from "../../hooks/useNow";
import { formatBytes } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { Callout } from "../ui/callout";
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

export function DataMeterDialog({
  clientKey,
  deviceName,
  open,
  onOpenChange,
}: {
  clientKey: string;
  deviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meter = useDataMeter(open ? clientKey : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='glass-panel gap-0 sm:max-w-lg' showCloseButton={false}>
        <MeterForm
          // The stored rule is the form's opening value, so the form is remounted
          // when a different one arrives rather than being written into by an
          // effect. Keyed on the rule's identity and not its usage, so the poll's
          // fresh figure every ten seconds never discards what is being typed.
          key={meter.rule ? `${meter.rule.clientKey}:${meter.rule.periodStartMs}` : "unset"}
          meter={meter}
          deviceName={deviceName}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function MeterForm({
  meter,
  deviceName,
  onOpenChange,
}: {
  meter: ReturnType<typeof useDataMeter>;
  deviceName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { rule, enforceable, error, save, restart, remove } = meter;
  const [allocationGB, setAllocationGB] = useState(rule ? gigabytes(rule.allocationBytes) : "50");
  const [pauseAtGB, setPauseAtGB] = useState(rule ? gigabytes(rule.pauseAtBytes) : "50");
  const [autoPause, setAutoPause] = useState(rule?.autoPause ?? true);
  const [kind, setKind] = useState<MeterCycle["kind"]>(rule?.cycle.kind ?? "monthly");
  const [weekday, setWeekday] = useState(rule?.cycle.kind === "weekly" ? rule.cycle.weekday : 1);
  const [day, setDay] = useState(rule?.cycle.kind === "monthly" ? rule.cycle.day : 1);
  const [busy, setBusy] = useState(false);
  // The countdown moves whether or not anything re-renders, and only ever reads
  // in hours, so a slow tick is enough.
  const nowMs = useNow(60_000);

  const allocationBytes = Math.max(0, Number(allocationGB) || 0) * GB;
  const pauseAtBytes = Math.min(Math.max(0, Number(pauseAtGB) || 0) * GB, allocationBytes);
  const used = rule?.usageBytes ?? 0;
  const remaining = pauseAtBytes - used;
  const spent = allocationBytes > 0 ? Math.min(1, used / allocationBytes) : 0;
  const pausePoint = allocationBytes > 0 ? Math.min(1, pauseAtBytes / allocationBytes) : 0;
  const willPauseOnSave = autoPause && rule !== null && used >= pauseAtBytes && pauseAtBytes > 0;

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
              <span className='font-semibold text-foreground'>{formatBytes(used)}</span>
              {allocationBytes > 0 && <> / {formatBytes(allocationBytes)}</>}
            </span>
          </div>
          {/* The pause point is marked on the bar rather than stated only as a
                number, so "how close is this device" is answerable at a glance. */}
          <div className='relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'>
            <div
              className='h-full rounded-full bg-[color-mix(in_srgb,var(--ink)_78%,var(--baseline))]'
              style={{ width: `${spent * 100}%` }}
            />
            {autoPause && pausePoint > 0 && pausePoint < 1 && (
              <div
                className='absolute inset-y-0 w-0.5 bg-destructive'
                style={{ left: `${pausePoint * 100}%` }}
              />
            )}
          </div>
          <div className='mt-1.5 text-[11.5px] text-muted-foreground'>
            {rule
              ? (endsIn(rule.periodEndMs, nowMs) ?? "Does not reset on its own")
              : "No limit set yet"}
          </div>
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
                  // The pause point cannot outrun the allowance it sits inside.
                  if (Number(pauseAtGB) > Number(event.target.value))
                    setPauseAtGB(event.target.value);
                }}
                className='pr-12 tabular-nums'
              />
              <span className='absolute inset-y-0 right-3 flex items-center text-[12px] text-muted-foreground'>
                GB
              </span>
            </div>
          </label>
          <label className='space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MeterCycle["kind"])}
              className='h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:border-ring'
            >
              {CYCLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {kind === "weekly" && (
          <label className='block space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets on</span>
            <select
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
              className='h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:border-ring'
            >
              {WEEKDAYS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "monthly" && (
          <label className='block space-y-1.5'>
            <span className='text-[12px] font-medium text-foreground'>Resets on day</span>
            <Input
              value={String(day)}
              inputMode='numeric'
              onChange={(event) =>
                setDay(Math.min(31, Math.max(1, Number(event.target.value) || 1)))
              }
              className='tabular-nums'
            />
          </label>
        )}

        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='text-[13px] font-medium text-foreground'>Pause when spent</div>
            <div className='text-[12px] text-muted-foreground'>
              Cuts this device’s internet until the cycle turns over.
            </div>
          </div>
          <Switch checked={autoPause} onCheckedChange={setAutoPause} />
        </div>

        {autoPause && (
          <div className='space-y-3'>
            <div className='flex items-center gap-3'>
              <div className='relative flex-1'>
                <Input
                  value={pauseAtGB}
                  inputMode='decimal'
                  onChange={(event) => setPauseAtGB(event.target.value)}
                  className='pr-12 tabular-nums'
                />
                <span className='absolute inset-y-0 right-3 flex items-center text-[12px] text-muted-foreground'>
                  GB
                </span>
              </div>
              <div
                className={`rounded-md px-3 py-2 text-[12.5px] font-medium tabular-nums ${
                  remaining <= 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-foreground"
                }`}
              >
                {formatBytes(Math.max(0, remaining))} left
              </div>
            </div>
            <Slider
              value={[Math.min(pauseAtBytes / GB, Number(allocationGB) || 0)]}
              max={Math.max(1, Number(allocationGB) || 0)}
              step={0.5}
              onValueChange={([next]) => setPauseAtGB(String(next))}
            />
            <div className='flex justify-between text-[11px] text-muted-foreground'>
              <span>0 GB</span>
              <span>{allocationGB || 0} GB allowance</span>
            </div>
          </div>
        )}

        {willPauseOnSave && (
          <Callout tone='error'>
            This device has already used more than that, so saving pauses it straight away.
          </Callout>
        )}
        {autoPause && !enforceable && (
          <Callout tone='error'>
            Connect your Starlink account for Dishylink to pause a device on its own. Until then the
            limit is watched and announced, but nothing is paused.
          </Callout>
        )}
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
                  pauseAtBytes: autoPause ? pauseAtBytes : allocationBytes,
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
