// The date grid, on react-day-picker.
//
// Themed entirely through `classNames` with the library's own stylesheet left
// out: `accent` here is `--grid-dot`, a near-black, so the stock theme would
// render the range band and the today marker as good as invisible.
//
// Dates cross this boundary as YYYY-MM-DD strings, since that is what a
// ScheduleWindow stores and what sorts without parsing. Date objects live no
// further out than this file.

import { DayPicker } from "react-day-picker";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local midnight, so a key never lands on the previous day through UTC. */
function dateOf(key: string | undefined): Date | undefined {
  return key ? new Date(`${key}T00:00:00`) : undefined;
}

const BAND = "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]";
const PICKED = "rdp-picked";
const MIDDLE = "rdp-middle";
const TODAY = "rdp-today";
const OFF = "rdp-off";

const dayCell = "flex flex-1 justify-center p-0 first:rounded-l-md last:rounded-r-md";

// Spelled out rather than built from the constants above: Tailwind extracts class
// names statically, so an interpolated variant is never generated at all. Every
// day of a range is `selected`, hence the :not() excluding the ones between.
const dayButton = [
  "relative size-7 cursor-pointer rounded-full text-[12px] text-foreground transition-colors",
  "hover:bg-[color-mix(in_srgb,var(--ink)_18%,transparent)]",
  "[.rdp-picked:not(.rdp-middle)>&]:bg-primary",
  "[.rdp-picked:not(.rdp-middle)>&]:font-semibold",
  "[.rdp-picked:not(.rdp-middle)>&]:text-primary-foreground",
  "[.rdp-today:not(.rdp-picked)>&]:font-bold",
  "[.rdp-today:not(.rdp-picked)>&]:text-[var(--accent)]",
  "[.rdp-off>&]:cursor-not-allowed",
  "[.rdp-off>&]:text-muted-foreground/50",
  "[.rdp-off>&]:hover:bg-transparent",
].join(" ");

const navButton =
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground " +
  "transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-foreground " +
  "active:scale-90 disabled:pointer-events-none disabled:opacity-40";

export function Calendar({
  from,
  to,
  onChange,
  range = false,
  className,
}: {
  from: string | undefined;
  to: string | undefined;
  /** `to` is undefined while a span is open — one end picked, waiting for the
   *  other. */
  onChange: (from: string, to: string | undefined) => void;
  range?: boolean;
  className?: string;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shared = {
    // Needs the library's stylesheet to hold the exiting month out of flow.
    // Without it the two captions overprint each other.
    animate: false,
    showOutsideDays: false,
    disabled: { before: today },
    defaultMonth: dateOf(from),
    numberOfMonths: range ? 2 : 1,
    className: cn("w-full", className),
    components: {
      Chevron: ({ orientation }: { orientation?: "left" | "right" | "up" | "down" }) => (
        <ChevronDown
          className={cn("size-3.5", orientation === "left" ? "rotate-90" : "-rotate-90")}
        />
      ),
    },
    classNames: {
      months: "flex gap-4",
      month: "min-w-0 flex-1 space-y-2",
      month_caption: "flex h-6 items-center justify-center",
      caption_label: "text-[13px] font-semibold tabular-nums text-foreground",
      nav: "absolute inset-x-0 top-0 flex items-center justify-between",
      button_previous: navButton,
      button_next: navButton,
      month_grid: "w-full border-collapse",
      weekdays: "flex",
      weekday:
        "flex-1 py-1 text-center text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase",
      week: "mt-1 flex w-full",
      day: dayCell,
      day_button: dayButton,
      selected: PICKED,
      today: TODAY,
      disabled: OFF,
      range_start: cn(PICKED, BAND, "rounded-l-md"),
      range_middle: cn(MIDDLE, BAND),
      range_end: cn(PICKED, BAND, "rounded-r-md"),
      outside: "text-muted-foreground/40",
      hidden: "invisible",
    },
  } as const;

  if (!range)
    return (
      <div className='relative'>
        <DayPicker
          {...shared}
          mode='single'
          selected={dateOf(from)}
          onSelect={(picked) => picked && onChange(dateKeyOf(picked), dateKeyOf(picked))}
        />
      </div>
    );

  return (
    <div className='relative'>
      <DayPicker
        {...shared}
        mode='range'
        resetOnSelect
        selected={{ from: dateOf(from), to: dateOf(to) }}
        onSelect={(picked) => {
          if (!picked?.from) return;
          onChange(dateKeyOf(picked.from), picked.to ? dateKeyOf(picked.to) : undefined);
        }}
      />
    </div>
  );
}
