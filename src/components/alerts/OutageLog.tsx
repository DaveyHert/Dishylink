// Recent outage / event log from the dish's history buffer, newest first.
// Layout mirrors the official app: time on the left, the event, then a tag/
// duration on the right, and each row opens its detail. Each cause carries a
// plain-English tooltip (the dish's raw jargon explained) via outageEventMeta.
// An outage the recorder timed owns its report, which the detail shows; a dish
// that stopped answering logged nothing itself, so its report is a row here.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "lucide-react";
import { canonicalCause, outageEventMeta, type OutageEvent } from "@core/telemetry";
import { assignReports, type OutageReport } from "@core/postmortem";
import { SYSTEM_ALERTS } from "@core/alertDefinitions";
import { formatClockTimeShort, formatEventDuration } from "../../lib/format";
import { EmptyState } from "../ui/empty-state";
import { InfoDot } from "../shared/InfoDot";
import { EventDetailModal } from "./EventDetailModal";
import { SeverityMark } from "./SeverityMark";

interface Row {
  event: OutageEvent;
  report: OutageReport | null;
}

export function OutageLog({
  outageEvents,
  reports,
  onOpenDevice,
}: {
  outageEvents: OutageEvent[];
  reports: OutageReport[];
  /** Opens a device's details in the network panel; absent where there is none. */
  onOpenDevice?: (entryKey: string) => void;
}) {
  const { t, i18n } = useTranslation();
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
        <div className='thin-scroll flex max-h-[240px] flex-col overflow-y-auto'>
          {rows.map((row) => {
            const { event } = row;
            const meta = outageEventMeta(event.cause, t);
            const time = formatClockTimeShort(event.startMs, i18n.language);
            // The row's button is stretched underneath its content rather than
            // wrapping it: the info dot is focusable, and a focusable element
            // inside a button is invalid and unreachable to a screen reader.
            return (
              <div
                className='group relative grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 border-b border-border px-0.5 py-2 text-[13px] font-medium last:border-b-0'
                key={`${event.startMs}-${canonicalCause(event.cause)}`}
              >
                <button
                  aria-label={`${time} ${meta.label}`}
                  className='absolute inset-0 cursor-pointer hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]'
                  onClick={() => setOpenRow(row)}
                  type='button'
                />
                <span className='pointer-events-none relative font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
                  {time}
                </span>
                <span className='pointer-events-none relative flex min-w-0 items-center gap-2'>
                  <SeverityMark severity={event.severity} />
                  <span className='overflow-hidden text-ellipsis whitespace-nowrap text-foreground'>
                    {meta.label}
                  </span>
                  {meta.tip && (
                    <span className='pointer-events-auto'>
                      <InfoDot tip={meta.tip} />
                    </span>
                  )}
                </span>
                <span className='pointer-events-none relative font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
                  {formatEventDuration(event.durationMs, t)}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className='pointer-events-none relative size-3.5 text-muted-foreground transition-colors group-hover:text-foreground'
                />
              </div>
            );
          })}
        </div>
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
}
