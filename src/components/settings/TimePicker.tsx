import { useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatClock12 } from "./sleepSchedule";
import { triggerClass } from "./settingsChrome";

const DAY_MINUTES = 1440;
const wrap = (minutes: number): number => ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

const stepBtnClass =
  "grid h-3 w-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer active:scale-90";
const digitClass = "text-[16px] font-semibold leading-none text-foreground tabular-nums";
const pillButtonBase =
  "cursor-pointer rounded-full px-3.5 py-1 text-[10px] font-semibold transition-opacity duration-[120ms] enabled:hover:opacity-85 disabled:cursor-default disabled:opacity-45";

const HOUR_TENS = [0, 1];
const HOUR_ONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const MINUTE_TENS = [0, 1, 2, 3, 4, 5];
const MINUTE_ONES = [0, 5, 1, 2, 3, 4, 6, 7, 8, 9];

function DigitColumn({ value, sequence }: { value: number; sequence: number[] }) {
  const index = sequence.indexOf(value);
  return (
    <span className={cn("relative inline-block h-[1em] w-[1ch] overflow-hidden", digitClass)}>
      <span
        className='absolute inset-x-0 flex flex-col transition-transform duration-300 ease-in-out'
        style={{ transform: `translateY(${-index}em)` }}
      >
        {sequence.map((n, i) => (
          <span key={i} className='flex h-[1em] shrink-0 items-center justify-center'>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

function TwoDigit({
  value,
  tensSequence,
  onesSequence,
}: {
  value: number;
  tensSequence: number[];
  onesSequence: number[];
}) {
  return (
    <span className='inline-flex'>
      <DigitColumn value={Math.floor(value / 10)} sequence={tensSequence} />
      <DigitColumn value={value % 10} sequence={onesSequence} />
    </span>
  );
}

/** A compact trigger, matching the other settings dropdowns, that opens a
 *  popover to dial in a time. Adjustments inside the popover are local until
 *  Set is pressed — Cancel or dismissing the popover discards them. */
export function TimePicker({
  minutes,
  onChange,
  disabled,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(minutes);

  const openWith = (next: boolean) => {
    if (next) setDraft(minutes);
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={openWith}>
      <PopoverTrigger asChild>
        <button type='button' className={triggerClass} disabled={disabled}>
          {formatClock12(minutes)}
          <ChevronDownIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-auto rounded-lg border-hairline px-3.5 py-2' align='start'>
        <TimeDial minutes={draft} onChange={setDraft} />
        <div className='my-1.5 h-px w-full bg-hairline' />
        <div className='flex justify-end gap-1.5'>
          <button
            type='button'
            className={cn(
              pillButtonBase,
              "bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] text-foreground",
            )}
            onClick={() => openWith(false)}
          >
            Cancel
          </button>
          <button
            type='button'
            className={cn(pillButtonBase, "bg-primary text-primary-foreground")}
            onClick={() => {
              if (draft !== minutes) onChange(draft);
              setOpen(false);
            }}
          >
            Set
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeDial({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const isPM = hour24 >= 12;

  const stepHour = (delta: number) => onChange(wrap(minutes + delta * 60));
  const stepMinute = (delta: number) => onChange(wrap(minutes + delta * 5));
  const setPeriod = (wantPM: boolean) => {
    if (wantPM !== isPM) onChange(wrap(minutes + 12 * 60));
  };

  const [editingHour, setEditingHour] = useState(false);
  const [editingMinute, setEditingMinute] = useState(false);
  const [hourInput, setHourInput] = useState("");
  const [minuteInput, setMinuteInput] = useState("");
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);

  const startEditHour = () => {
    setHourInput(String(hour12));
    setEditingHour(true);
    requestAnimationFrame(() => hourInputRef.current?.select());
  };
  const commitHour = () => {
    const typed = parseInt(hourInput, 10);
    if (!Number.isNaN(typed) && typed >= 1 && typed <= 12) {
      const nextHour24 = isPM ? (typed === 12 ? 12 : typed + 12) : typed === 12 ? 0 : typed;
      onChange(nextHour24 * 60 + minute);
    }
    setEditingHour(false);
  };
  const startEditMinute = () => {
    setMinuteInput(String(minute).padStart(2, "0"));
    setEditingMinute(true);
    requestAnimationFrame(() => minuteInputRef.current?.select());
  };
  const commitMinute = () => {
    const typed = parseInt(minuteInput, 10);
    if (!Number.isNaN(typed) && typed >= 0 && typed <= 59) onChange(hour24 * 60 + typed);
    setEditingMinute(false);
  };

  const digitInputClass = cn(
    digitClass,
    "w-8 rounded-sm bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
  );

  return (
    <div className='flex items-center justify-center gap-1.5'>
      <TimeStepper
        label='hour'
        onUp={() => stepHour(1)}
        onDown={() => stepHour(-1)}
        editing={editingHour}
      >
        {editingHour ? (
          <input
            ref={hourInputRef}
            type='number'
            min={1}
            max={12}
            value={hourInput}
            onChange={(event) => setHourInput(event.target.value)}
            onBlur={commitHour}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitHour();
              if (event.key === "Escape") setEditingHour(false);
            }}
            onFocus={(event) => event.target.select()}
            className={digitInputClass}
          />
        ) : (
          <button
            type='button'
            onClick={startEditHour}
            title='Click to type'
            className='grid w-8 cursor-text place-items-center rounded-sm transition-colors hover:bg-accent'
          >
            <TwoDigit value={hour12} tensSequence={HOUR_TENS} onesSequence={HOUR_ONES} />
          </button>
        )}
      </TimeStepper>

      <span className='text-[16px] font-semibold leading-none text-muted-foreground'>:</span>

      <TimeStepper
        label='minute'
        onUp={() => stepMinute(1)}
        onDown={() => stepMinute(-1)}
        editing={editingMinute}
      >
        {editingMinute ? (
          <input
            ref={minuteInputRef}
            type='number'
            min={0}
            max={59}
            value={minuteInput}
            onChange={(event) => setMinuteInput(event.target.value)}
            onBlur={commitMinute}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitMinute();
              if (event.key === "Escape") setEditingMinute(false);
            }}
            onFocus={(event) => event.target.select()}
            className={digitInputClass}
          />
        ) : (
          <button
            type='button'
            onClick={startEditMinute}
            title='Click to type'
            className='grid w-8 cursor-text place-items-center rounded-sm transition-colors hover:bg-accent'
          >
            <TwoDigit value={minute} tensSequence={MINUTE_TENS} onesSequence={MINUTE_ONES} />
          </button>
        )}
      </TimeStepper>

      <div className='ml-1 flex flex-col items-center gap-0.5'>
        {(
          [
            ["AM", false],
            ["PM", true],
          ] as const
        ).map(([label, wantPM]) => {
          const active = wantPM === isPM;
          return (
            <button
              key={label}
              type='button'
              onClick={() => setPeriod(wantPM)}
              className={cn(
                "cursor-pointer rounded-[3px] px-1.5 py-0.5 text-[9px] font-semibold uppercase transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A vertical hour/minute control: up chevron, the (animated or editable) digits, down chevron. */
function TimeStepper({
  label,
  onUp,
  onDown,
  editing,
  children,
}: {
  label: string;
  onUp: () => void;
  onDown: () => void;
  editing: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col items-center gap-0.5'>
      <button
        type='button'
        onClick={onUp}
        aria-label={`Increase ${label}`}
        tabIndex={editing ? -1 : 0}
        className={stepBtnClass}
      >
        <ChevronUpIcon className='size-3' />
      </button>
      {children}
      <button
        type='button'
        onClick={onDown}
        aria-label={`Decrease ${label}`}
        tabIndex={editing ? -1 : 0}
        className={stepBtnClass}
      >
        <ChevronDownIcon className='size-3' />
      </button>
    </div>
  );
}
