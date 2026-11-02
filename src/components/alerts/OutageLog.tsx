// Recent outage / event log from the dish's history buffer, newest first.
// Layout mirrors the official app: time on the left, the event, then a tag/
// duration on the right, and each row opens its detail. Each cause carries a
// plain-English tooltip (the dish's raw jargon explained) via outageEventMeta.
// An outage the recorder timed owns its report, which the detail shows; a dish
// that stopped answering logged nothing itself, so its report is a row here.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon } from "lucide-react";
import { canonicalCause, outageEventMeta, type OutageEvent } from "@core/telemetry";
import { assignReports, type OutageReport } from "@core/postmortem";
import { SYSTEM_ALERTS } from "@core/alertDefinitions";
import {
  formatClockTimeShort,
  formatDate,
  formatDateTime,
  formatEventDuration,
} from "../../lib/format";
import { EmptyState } from "../ui/empty-state";
import { InfoDot } from "../shared/InfoDot";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useTimeLocale } from "../../hooks/useTimeLocale";
import { EventDetailModal } from "./EventDetailModal";
import { EventKindMark } from "./EventKindMark";
import { eventDetailKind } from "./eventDetail";

interface Row {
  event: OutageEvent;
  report: OutageReport | null;
}

// A busy network logs thousands of events (band switches alone land every few
// minutes), so only the rows in view are built; the rest are spacer height.
const ROW_ESTIMATE_PX = 37;
const LIST_MAX_HEIGHT_PX = 240;

function rowKey(row: Row): string {
  return `${row.event.startMs}-${canonicalCause(row.event.cause)}`;
}

/** Characters in this locale's widest clock time. With only some rows drawn,
 *  the time column would otherwise resize as wider times scroll into view. */
function widestClockTime(locale: string): number {
  let widest = 0;
  for (let hour = 0; hour < 24; hour++) {
    const sample = formatClockTimeShort(new Date(2024, 0, 1, hour, 59).getTime(), locale);
    widest = Math.max(widest, sample.length);
  }
  return widest;
}

const EventRow = memo(function EventRow({
  row,
  index,
  timeLocale,
  timeWidthCh,
  onOpen,
  measure,
}: {
  row: Row;
  index: number;
  timeLocale: string;
  timeWidthCh: number;
  onOpen: (row: Row) => void;
  measure: (element: Element | null) => void;
}) {
  const { t } = useTranslation();
  const { event } = row;
  const meta = outageEventMeta(event.cause, t);
  // The row's button is stretched underneath its content rather than wrapping
  // it: the info dot is focusable, and a focusable element inside a button is
  // invalid and unreachable to a screen reader.
  return (
    <div
      ref={measure}
      data-index={index}
      className='group relative col-span-4 grid grid-cols-subgrid items-center gap-2.5 border-b border-border px-0.5 py-2 text-[13px] font-medium last:border-b-0'
    >
      <button
        aria-label={`${formatDateTime(event.startMs, timeLocale)} ${meta.label}`}
        className='absolute inset-0 cursor-pointer hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]'
        onClick={() => onOpen(row)}
        type='button'
      />
      {/* Takes the pointer so its date tip can show, so it opens the row itself
          rather than letting the click through. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className='relative cursor-pointer font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'
            style={{ minWidth: `${timeWidthCh}ch` }}
            onClick={() => onOpen(row)}
          >
            {formatClockTimeShort(event.startMs, timeLocale)}
          </span>
        </TooltipTrigger>
        {/* The chart's hover card, so every hover readout looks alike. */}
        <TooltipContent
          side='top'
          arrowClassName='bg-popover fill-popover'
          className='rounded-md bg-popover px-[11px] py-[6px] font-mono text-[11px] text-foreground shadow-[0_8px_28px_rgba(0,0,0,0.35)]'
        >
          {formatDate(event.startMs, timeLocale)}
        </TooltipContent>
      </Tooltip>
      <span className='pointer-events-none relative flex min-w-0 items-center gap-2'>
        <EventKindMark kind={eventDetailKind(event, row.report)} />
        <span className='overflow-hidden text-ellipsis whitespace-nowrap text-foreground'>
          {meta.label}
        </span>
        {meta.tip && (
          <span className='pointer-events-auto'>
            <InfoDot tip={meta.tip} />
          </span>
        )}
      </span>
      <span className='pointer-events-none relative min-w-[7ch] font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
        {formatEventDuration(event.durationMs, t)}
      </span>
      <ChevronRightIcon
        aria-hidden
        className='pointer-events-none relative size-3.5 text-muted-foreground transition-colors group-hover:text-foreground'
      />
    </div>
  );
});

// Memoised so the dashboard's every-second redraw passes it by while its events
// hold still.
export const OutageLog = memo(function OutageLog({
  outageEvents,
  reports,
  onOpenDevice,
}: {
  outageEvents: OutageEvent[];
  reports: OutageReport[];
  /** Opens a device's details in the network panel; absent where there is none. */
  onOpenDevice?: (entryKey: string) => void;
}) {
  const { t } = useTranslation();
  const timeLocale = useTimeLocale();
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const rows = useMemo<Row[]>(() => {
    const { byEvent, unclaimed } = assignReports(reports, outageEvents);
    const eventRows = outageEvents.map((event) => ({
      event,
      report: byEvent.get(event) ?? null,
    }));
    const reportRows = unclaimed.map((report) => ({
      event: {
        startMs: report.startMs,
        durationMs: report.durationMs,
        cause: t(`eventDetail.${report.source}`),
        severity: SYSTEM_ALERTS[report.source].severity,
      },
      report,
    }));
    return [...eventRows, ...reportRows].sort((a, b) => b.event.startMs - a.event.startMs);
  }, [outageEvents, reports, t]);

  const timeWidthCh = useMemo(() => widestClockTime(timeLocale), [timeLocale]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (index) => rowKey(rows[index]),
    overscan: 8,
    // The list's own height, so the first frame already draws a page of rows.
    initialRect: { width: 0, height: LIST_MAX_HEIGHT_PX },
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length > 0 ? items[0].start : 0;
  const padBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const openEvent = useCallback((row: Row) => setOpenRow(row), []);

  return (
    <div className='col-span-4 min-w-0 rounded-xl bg-card px-[18px] py-4'>
      <div className='mb-2.5 flex items-center justify-between gap-3'>
        <span className='text-[16px] font-semibold tracking-[0.005em] text-foreground'>
          {t("events.title")}
        </span>
        <span className='text-[12px] font-medium text-muted-foreground'>
          {t("events.count", { count: rows.length })}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState className='py-[18px]'>{t("events.empty")}</EmptyState>
      ) : (
        // Its own provider so the list works wherever it is mounted; the app's
        // root provider uses the same delay.
        <TooltipProvider delayDuration={200}>
          <div
            ref={scrollRef}
            className='thin-scroll grid grid-cols-[auto_1fr_auto_auto] content-start overflow-y-auto'
            style={{ maxHeight: LIST_MAX_HEIGHT_PX }}
          >
            {padTop > 0 && <div aria-hidden className='col-span-4' style={{ height: padTop }} />}
            {items.map((item) => (
              <EventRow
                key={item.key}
                row={rows[item.index]}
                index={item.index}
                timeLocale={timeLocale}
                timeWidthCh={timeWidthCh}
                onOpen={openEvent}
                measure={virtualizer.measureElement}
              />
            ))}
            {padBottom > 0 && (
              <div aria-hidden className='col-span-4' style={{ height: padBottom }} />
            )}
          </div>
        </TooltipProvider>
      )}
      {openRow && (
        <EventDetailModal
          event={openRow.event}
          report={openRow.report}
          onClose={() => setOpenRow(null)}
          onOpenDevice={
            onOpenDevice &&
            ((entryKey) => {
              setOpenRow(null);
              onOpenDevice(entryKey);
            })
          }
        />
      )}
    </div>
  );
});
