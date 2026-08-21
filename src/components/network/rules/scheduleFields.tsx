// Setting the times a rule lets its devices online: one block per window, since
// weekday evenings and longer weekends are two rows of one rule, not two rules.

import { Plus, X } from "lucide-react";
import type { Schedule } from "@core/schedule";
import { Button } from "../../ui/button";
import { SegmentedControl } from "../../ui/segmented-control";
import { Calendar } from "../../ui/calendar";
import { TimeOfDayField } from "../../ui/time-of-day-field";
import {
  clockLabel,
  daysLabel,
  repeatTerms,
  runLabel,
  WEEKDAY_LABELS,
  type ScheduleDraft,
} from "./scheduleTerms";

/** A schedule's hours, read back rather than edited: the mode it opens the
 *  device on, and each window it names. Shared by every card that shows a
 *  schedule rule's status, so a window reads the same way wherever it is seen. */
export function ScheduleWindows({
  schedule,
  max,
  compact = false,
}: {
  schedule: Schedule;
  /** Windows to draw before the rest are summed up, for a card with a row's worth
   *  of space rather than a dialog's. */
  max?: number;
  compact?: boolean;
}) {
  const shown = max === undefined ? schedule.windows : schedule.windows.slice(0, max);
  const rest = schedule.windows.length - shown.length;
  return (
    <>
      <div
        className={
          compact
            ? "flex justify-between gap-3 text-[11px] tracking-wide text-muted-foreground uppercase"
            : "text-[11px] tracking-wide text-muted-foreground uppercase"
        }
      >
        <span>{schedule.mode === "allow" ? "Online" : "Offline"}</span>
        {compact && <span>Hours</span>}
      </div>
      {shown.map((window, index) => (
        <div
          key={index}
          className={
            compact
              ? "flex justify-between gap-3 text-[12.5px]"
              : "flex items-baseline justify-between gap-3"
          }
        >
          <span
            className={compact ? "text-foreground" : "text-[15px] font-semibold text-foreground"}
          >
            {daysLabel(window)}
          </span>
          <span
            className={
              compact
                ? "font-medium tabular-nums text-foreground"
                : "text-[13px] tabular-nums text-muted-foreground"
            }
          >
            {clockLabel(window.startMinute)} – {clockLabel(window.endMinute)}
          </span>
        </div>
      ))}
      {rest > 0 && <div className='text-[12px] text-muted-foreground'>and {rest} more</div>}
    </>
  );
}

export function ScheduleFields({ draft }: { draft: ScheduleDraft }) {
  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <div className='text-[13px] font-medium text-foreground'>Schedule</div>
          <div className='text-[12px] text-muted-foreground'>
            {draft.mode === "allow"
              ? "Online during these times, paused the rest of the days."
              : "Paused during these times, online otherwise."}
          </div>
        </div>
        <SegmentedControl
          label='What the schedule does'
          value={draft.mode}
          onChange={draft.setMode}
          options={[
            { value: "allow", label: "Online" },
            { value: "block", label: "Offline" },
          ]}
        />
      </div>

      {draft.windows.map((window, index) => (
        <div
          key={index}
          className='space-y-3 rounded-lg border border-border/60 bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] p-3'
        >
          <div className='flex items-center justify-between gap-2'>
            {/* Not the section header's segmented control: that sets what the
                whole schedule does, this only sets how one window repeats. */}
            <div className='flex items-center gap-0.5 text-[12px]'>
              {(
                [
                  ["weekly", "Every week"],
                  ["range", "Date range"],
                  ["once", "One-off"],
                ] as const
              ).map(([repeat, repeatLabel]) => (
                <button
                  key={repeat}
                  type='button'
                  aria-pressed={window.repeat === repeat}
                  onClick={() => draft.updateWindow(index, repeatTerms(repeat))}
                  className={`cursor-pointer rounded-md px-2 py-1 transition-colors ${
                    window.repeat === repeat
                      ? "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {repeatLabel}
                </button>
              ))}
            </div>
            <div className='flex min-w-0 items-center gap-2'>
              {window.repeat !== "weekly" && (
                <span className='truncate text-[12px] text-muted-foreground'>
                  {runLabel(window) ?? "Pick a date"}
                </span>
              )}
              <button
                type='button'
                onClick={() => draft.removeWindow(index)}
                aria-label='Remove this schedule'
                className='grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-foreground'
              >
                <X className='size-3.5' />
              </button>
            </div>
          </div>

          {window.repeat === "weekly" ? (
            <div className='flex justify-center gap-1'>
              {WEEKDAY_LABELS.map((label, weekday) => {
                const picked = window.weekdays.includes(weekday);
                return (
                  <button
                    key={label}
                    type='button'
                    onClick={() => draft.toggleWeekday(index, weekday)}
                    className={`cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      picked
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <Calendar
              from={window.fromDate}
              to={window.toDate}
              range={window.repeat === "range"}
              onChange={(fromDate, toDate) => draft.updateWindow(index, { fromDate, toDate })}
            />
          )}

          <div className='flex flex-wrap items-center gap-x-5 gap-y-3'>
            <TimeOfDayField
              label='From'
              value={window.startMinute}
              onChange={(startMinute) => draft.updateWindow(index, { startMinute })}
            />
            <TimeOfDayField
              label='To'
              value={window.endMinute}
              onChange={(endMinute) => draft.updateWindow(index, { endMinute })}
            />
          </div>

          {window.endMinute <= window.startMinute && (
            <p className='text-[11.5px] text-muted-foreground'>
              Runs past midnight into the next day.
            </p>
          )}
        </div>
      ))}

      <Button
        variant='outline'
        size='sm'
        className='w-full cursor-pointer'
        onClick={draft.addWindow}
      >
        <Plus className='size-3.5' />
        {draft.windows.length === 0 ? "Set a schedule" : "Add another time"}
      </Button>
    </div>
  );
}
