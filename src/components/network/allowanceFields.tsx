// The allowance, timer and membership controls, shared by every card that sets a
// limit.
//
// One device or several is the only structural difference between a rule and a
// group, so the same fields write both. A limit that read one way on a device and
// another on a group would be two features wearing one name.

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, TimerIcon } from "lucide-react";
import { MAX_COUNTDOWN_MS, type MeterCycle } from "@core/dataMeter";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  CYCLE_OPTIONS,
  MINUTE_MS,
  WEEKDAYS,
  ceilingFor,
  ceilingLabel,
  formatDuration,
  orderedCandidates,
  stepButtonClass,
  stepCeiling,
  stepDay,
  stepFor,
  type AllowanceDraft,
  type MemberCandidate,
} from "./allowanceTerms";

/** The chip that turns the form from an allowance into a countdown. Sits in the
 *  header, where it reads as which of the two this rule is rather than as a
 *  setting within one of them. */
export function AllowanceModeToggle({ draft }: { draft: AllowanceDraft }) {
  const { timer, setTimer } = draft;
  return (
    <button
      type='button'
      onClick={() => setTimer(!timer)}
      aria-pressed={timer}
      title={timer ? "Measure an allowance instead" : "Count down instead"}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        timer
          ? "border-transparent bg-[color-mix(in_srgb,var(--ink)_88%,var(--baseline))] text-[var(--baseline)]"
          : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <TimerIcon className='size-3.5' />
      Timer
    </button>
  );
}

const QUICK_DURATIONS_MIN = [30, 60, 120, 360, 720, 1440];

function CountdownFields({ draft }: { draft: AllowanceDraft }) {
  const { hoursText, setHoursText, minutesText, setMinutesText, countdownMs } = draft;
  const setTotal = (totalMinutes: number) => {
    const clamped = Math.min(24 * 60, Math.max(1, totalMinutes));
    setHoursText(String(Math.floor(clamped / 60)));
    setMinutesText(String(clamped % 60));
  };
  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-3'>
        <label className='space-y-1.5'>
          <span className='text-[12px] font-medium text-foreground'>Hours</span>
          <Input
            value={hoursText}
            inputMode='numeric'
            onChange={(event) => setHoursText(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => setHoursText(String(Math.min(24, Number(hoursText) || 0)))}
            className='tabular-nums'
          />
        </label>
        <label className='space-y-1.5'>
          <span className='text-[12px] font-medium text-foreground'>Minutes</span>
          <Input
            value={minutesText}
            inputMode='numeric'
            onChange={(event) => setMinutesText(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => setMinutesText(String(Math.min(59, Number(minutesText) || 0)))}
            className='tabular-nums'
          />
        </label>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {QUICK_DURATIONS_MIN.map((minutes) => (
          <button
            key={minutes}
            type='button'
            onClick={() => setTotal(minutes)}
            className='cursor-pointer rounded-full border border-border/70 px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          >
            {formatDuration(minutes * MINUTE_MS)}
          </button>
        ))}
      </div>
      {countdownMs !== undefined && countdownMs >= MAX_COUNTDOWN_MS && (
        <p className='text-[11.5px] text-muted-foreground'>
          A timer runs for at most 24 hours. Use an allowance for anything longer.
        </p>
      )}
    </div>
  );
}

/**
 * Which devices this limit covers, and how it reaches them.
 *
 * One device is a rule on that device. More than one is a group, and the choice
 * below it is the whole difference a group makes: shared spends one allowance
 * between them, each gives every device the allowance on its own.
 */
export function AppliesToField({
  candidates,
  selected,
  onToggle,
  shared,
  onSharedChange,
  timer,
}: {
  candidates: MemberCandidate[];
  selected: string[];
  onToggle: (clientKey: string) => void;
  shared: boolean;
  onSharedChange: (next: boolean) => void;
  /** A countdown starts and ends on one clock for every member, so sharing and
   *  each would do the same thing and the choice is not offered. */
  timer: boolean;
}) {
  const [open, setOpen] = useState(selected.length > 1);
  const summary = selected.length <= 1 ? "This device" : `${selected.length} devices`;
  // Held still while the picker is open. The odometer's list refreshes on its own
  // poll, and a row that moves under the cursor is one the user has to chase.
  const rows = useMemo(() => orderedCandidates(candidates), [candidates]);
  return (
    <div className='space-y-1.5'>
      <div className='flex items-baseline justify-between'>
        <span className='text-[12px] font-medium text-foreground'>Applies to</span>
        <button
          type='button'
          onClick={() => setOpen(!open)}
          className='cursor-pointer rounded-sm px-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        >
          {summary}
          <ChevronDownIcon
            className={`ml-1 inline size-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
        <>
          <div className='thin-scroll max-h-36 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 p-1'>
            {rows.map((candidate) => (
              <label
                key={candidate.clientKey}
                className='flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent'
              >
                <input
                  type='checkbox'
                  className='size-3.5 accent-[var(--ink)]'
                  checked={selected.includes(candidate.clientKey)}
                  onChange={() => onToggle(candidate.clientKey)}
                />
                <span className='truncate'>{candidate.name}</span>
                {candidate.active && (
                  <span className='ml-auto shrink-0 text-[10.5px] tracking-wide text-muted-foreground'>
                    ACTIVE NOW
                  </span>
                )}
              </label>
            ))}
          </div>
          {selected.length > 1 && !timer && (
            <div className='grid grid-cols-2 gap-2 pt-1'>
              <MemberModeChoice
                selected={!shared}
                onSelect={() => onSharedChange(false)}
                title='Each'
                detail='Every device gets the full allowance on its own.'
              />
              <MemberModeChoice
                selected={shared}
                onSelect={() => onSharedChange(true)}
                title='Shared'
                detail='One allowance between them. They pause together.'
              />
            </div>
          )}
          {selected.length > 1 && timer && (
            <p className='pt-1 text-[11.5px] text-muted-foreground'>
              All {selected.length} devices start and end on one clock.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MemberModeChoice({
  selected,
  onSelect,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      className={`cursor-pointer rounded-lg border p-2.5 text-left transition-colors ${
        selected
          ? "border-[color-mix(in_srgb,var(--ink)_45%,transparent)] bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
          : "border-border/60 hover:bg-accent"
      }`}
    >
      <span className='block text-[13px] font-medium text-foreground'>{title}</span>
      <span className='mt-0.5 block text-[11.5px] leading-snug text-muted-foreground'>
        {detail}
      </span>
    </button>
  );
}

export function AllowanceFields({ draft }: { draft: AllowanceDraft }) {
  const { allocationText, setAllocationText, ceiling, setCeiling, kind, billingDay } = draft;
  if (draft.timer) return <CountdownFields draft={draft} />;
  return (
    <>
      <div className='grid grid-cols-2 gap-3'>
        <label className='space-y-1.5'>
          <span className='text-[12px] font-medium text-foreground'>Allowance</span>
          <div className='relative'>
            <Input
              value={allocationText}
              inputMode='decimal'
              onChange={(event) => {
                setAllocationText(event.target.value);
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
          <Select value={kind} onValueChange={(next) => draft.setKind(next as MeterCycle["kind"])}>
            <SelectTrigger className='w-full text-[13px]' aria-label='Resets'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CYCLE_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.value === "billing" && billingDay === null}
                >
                  {option.value === "billing"
                    ? billingDay === null
                      ? "Starlink billing — needs your account"
                      : `Starlink billing (${billingDay})`
                    : option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='flex items-center gap-3'>
        <Slider
          value={[Math.min(Number(allocationText) || 0, ceiling)]}
          max={ceiling}
          step={stepFor(ceiling)}
          onValueChange={([next]) => setAllocationText(String(next))}
          aria-label='Allowance in gigabytes'
        />
        <div className='flex shrink-0 flex-col items-center gap-0.5'>
          <button
            type='button'
            onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationText) || 0, 1))}
            aria-label='Extend the slider'
            className={stepButtonClass}
          >
            <ChevronUpIcon className='size-3' />
          </button>
          <button
            type='button'
            onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationText) || 0, 1))}
            title='Change how far the slider reaches'
            className='cursor-pointer rounded-sm px-1 text-[11.5px] leading-none tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          >
            {ceilingLabel(ceiling)}
          </button>
          <button
            type='button'
            onClick={() => setCeiling(stepCeiling(ceiling, Number(allocationText) || 0, -1))}
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
          <Select
            value={String(draft.weekday)}
            onValueChange={(next) => draft.setWeekday(Number(next))}
          >
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
              value={draft.dayText}
              inputMode='numeric'
              onChange={(event) => draft.setDayText(event.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => draft.setDayText(String(draft.day))}
              className='pr-9 tabular-nums'
            />
            <div className='absolute inset-y-0 right-2 flex flex-col justify-center gap-0.5'>
              <button
                type='button'
                onClick={() => draft.setDayText(String(stepDay(draft.day, 1)))}
                aria-label='Later in the month'
                className={stepButtonClass}
              >
                <ChevronUpIcon className='size-3' />
              </button>
              <button
                type='button'
                onClick={() => draft.setDayText(String(stepDay(draft.day, -1)))}
                aria-label='Earlier in the month'
                className={stepButtonClass}
              >
                <ChevronDownIcon className='size-3' />
              </button>
            </div>
          </div>
        </label>
      )}
    </>
  );
}
