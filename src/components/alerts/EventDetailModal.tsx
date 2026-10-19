// One event's detail, as the official app opens from an event row: what it
// was, when, for how long, and the explanation. An event the recorder timed
// carries its report too: the five minutes before the drop, the heater and any
// thermal episode, frozen the moment the outage ended, with the report one
// button away as text or JSON.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { outageEventMeta, type EventKind, type OutageEvent } from "@core/telemetry";
import type { OutageReport } from "@core/postmortem";
import { DetailsModal } from "../ui/details-modal";
import { actionButton } from "../ui/action-button";
import { Badge } from "../ui/badge";
import { Callout } from "../ui/callout";
import { formatEventDuration } from "../../lib/format";
import { DataRow, SectionHeading } from "../network/DataRow";
import { BandSwitchBands, BandSwitchDevice } from "./BandSwitchDetail";
import {
  eventDetailKind,
  eventDetailSpan,
  eventDetailText,
  eventDetailTitle,
  reportSections,
} from "./eventDetail";

const KIND_TONE: Record<EventKind, "critical" | "warm" | "neutral"> = {
  outage: "critical",
  degraded: "warm",
  info: "neutral",
};

export function EventDetailModal({
  event,
  report,
  onClose,
  onOpenDevice,
}: {
  event: OutageEvent;
  report: OutageReport | null;
  onClose: () => void;
  onOpenDevice?: (entryKey: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const meta = outageEventMeta(event.cause, t);
  const kind = eventDetailKind(event, report);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };
  const copyLabel = (idle: string) =>
    copyState === "copied"
      ? t("eventDetail.copied")
      : copyState === "failed"
        ? t("eventDetail.copyFailed")
        : idle;

  return (
    <DetailsModal title={t("eventDetail.title")} onClose={onClose} size='default'>
      <div className='mt-2'>
        <div className='flex items-center justify-between gap-3'>
          <span className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='text-[16px] font-semibold text-foreground'>
              {eventDetailTitle(event, t)}
            </span>
            <Badge variant='status' tone={KIND_TONE[kind]}>
              {t(`eventDetail.kind.${kind}`)}
            </Badge>
          </span>
          <span className='font-mono text-[13px] whitespace-nowrap text-foreground tabular-nums'>
            {formatEventDuration(event.durationMs, t)}
          </span>
        </div>
        <div className='mt-1 text-[13px] font-medium text-muted-foreground'>
          {eventDetailSpan(event, t, i18n.language)}
          {report && ` · ${t(`eventDetail.${report.source}`)}`}
        </div>
        {event.bandSwitch && <BandSwitchBands bandSwitch={event.bandSwitch} />}
        {meta.tip && <p className='mt-3 text-[13px] leading-normal text-foreground'>{meta.tip}</p>}
        {event.bandSwitch && (
          <BandSwitchDevice bandSwitch={event.bandSwitch} onOpenDevice={onOpenDevice} />
        )}

        {event.bandSwitch ? null : report ? (
          reportSections(report, t, i18n.language).map((section) => (
            <section key={section.title}>
              <SectionHeading title={section.title} />
              {section.rows.map((row) => (
                <DataRow key={row.label} label={row.label} value={row.value} />
              ))}
              {section.note && (
                <p
                  className={
                    section.rows.length > 0
                      ? "mt-2 text-[12.5px] font-medium text-ink-secondary"
                      : "text-[13px] text-foreground"
                  }
                >
                  {section.note}
                </p>
              )}
            </section>
          ))
        ) : (
          <Callout tone='info' className='mt-4'>
            {t("eventDetail.noReport")}
          </Callout>
        )}

        {report && (
          <div className='mt-5 flex gap-2 border-t border-border pt-3'>
            <button
              className={actionButton("subtle")}
              onClick={() => void copy(JSON.stringify(report, null, 2))}
            >
              {copyLabel(t("eventDetail.copyJson"))}
            </button>
            <button
              className={actionButton("subtle")}
              onClick={() => void copy(eventDetailText(event, report, t, i18n.language))}
            >
              {copyLabel(t("eventDetail.copyText"))}
            </button>
          </div>
        )}
      </div>
    </DetailsModal>
  );
}
