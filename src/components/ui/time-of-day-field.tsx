// Picking a time of day: two steppers and an AM/PM pair.
//
// The value is minutes from local midnight throughout, which is what a
// ScheduleWindow stores, so nothing here builds a Date to hand back. Wrapping is
// deliberate — stepping past midnight lands on the other side of it rather than
// stopping, since a window may run into the next day.

import { useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const MINUTES_PER_DAY = 1440;
const CONTROL_SURFACE = "bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]";

const stepButton =
  "grid h-4 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-foreground active:scale-90";
const digits = "text-[22px] font-semibold leading-none tabular-nums text-foreground";

export function TimeOfDayField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Minutes from local midnight. */
  value: number;
  onChange: (minutes: number) => void;
}) {
  const hour24 = Math.floor(value / 60);
  const minute = value % 60;
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 || 12;

  const shift = (delta: number) =>
    onChange((((value + delta) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);

  return (
    <div className='flex items-center gap-2.5'>
      <span className='text-[12px] text-muted-foreground'>{label}</span>
      <div className='flex items-center gap-2'>
        <StepColumn
          unit='hour'
          onUp={() => shift(60)}
          onDown={() => shift(-60)}
          value={hour12}
          onCommit={(typed) => {
            if (typed < 1 || typed > 12) return;
            const next24 = isPm ? (typed === 12 ? 12 : typed + 12) : typed === 12 ? 0 : typed;
            onChange(next24 * 60 + minute);
          }}
        />
        <span className='pb-1.5 text-[22px] leading-none font-semibold text-muted-foreground/70'>
          :
        </span>
        <StepColumn
          unit='minute'
          onUp={() => shift(1)}
          onDown={() => shift(-1)}
          value={minute}
          onCommit={(typed) => {
            if (typed < 0 || typed > 59) return;
            onChange(hour24 * 60 + typed);
          }}
        />
        <div className='ml-1 flex flex-col gap-1'>
          {(["AM", "PM"] as const).map((period) => {
            const active = period === "PM" ? isPm : !isPm;
            return (
              <button
                key={period}
                type='button'
                onClick={() => !active && shift(12 * 60)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase transition-colors",
                  active
                    ? `${CONTROL_SURFACE} text-foreground`
                    : "cursor-pointer text-muted-foreground/70 hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-foreground",
                )}
              >
                {period}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Two chevrons around a figure that can also be typed into. */
function StepColumn({
  unit,
  value,
  onUp,
  onDown,
  onCommit,
}: {
  unit: string;
  value: number;
  onUp: () => void;
  onDown: () => void;
  onCommit: (typed: number) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);

  const commit = () => {
    const typed = Number.parseInt(draft, 10);
    if (Number.isFinite(typed)) onCommit(typed);
    setTyping(false);
  };

  return (
    <div className='flex flex-col items-center gap-0.5'>
      <button
        type='button'
        onClick={onUp}
        aria-label={`Increase ${unit}`}
        className={stepButton}
        tabIndex={typing ? -1 : 0}
      >
        <ChevronDown className='size-3 rotate-180' />
      </button>
      {typing ? (
        <input
          ref={field}
          type='number'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setTyping(false);
          }}
          onFocus={(event) => event.target.select()}
          className={cn(
            digits,
            CONTROL_SURFACE,
            "w-11 rounded-md text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
          )}
        />
      ) : (
        <button
          type='button'
          onClick={() => {
            setDraft(String(value));
            setTyping(true);
            requestAnimationFrame(() => field.current?.select());
          }}
          title='Click to type'
          className='grid w-11 cursor-text place-items-center rounded-md py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]'
        >
          <NumberFlow value={value} format={{ minimumIntegerDigits: 2 }} className={digits} />
        </button>
      )}
      <button
        type='button'
        onClick={onDown}
        aria-label={`Decrease ${unit}`}
        className={stepButton}
        tabIndex={typing ? -1 : 0}
      >
        <ChevronDown className='size-3' />
      </button>
    </div>
  );
}
