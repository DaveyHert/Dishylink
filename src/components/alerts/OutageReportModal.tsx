// The shareable form of an outage post-mortem: a human card rendered from the
// recorder's frozen report, with the report JSON itself one button away. The
// card is generated output, not live data — every figure was stamped the moment
// the outage ended, so what is shown is exactly what gets copied.

import { useState } from "react";
import type { OutageReport } from "@core/postmortem";
import { DetailsModal } from "../ui/details-modal";
import { actionButton } from "../ui/action-button";
import {
  formatClockTimeShort,
  formatDateTime,
  formatEventDuration,
  formatThroughputLabel,
} from "../../lib/format";
import {
  causeLabel,
  outageReportText,
  SNOW_MELT_LABEL,
  SOURCE_LABEL,
  THERMAL_LABEL,
} from "../../lib/outageReportText";

export function OutageReportModal({
  report,
  onClose,
}: {
  report: OutageReport;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "json" | "text" | "failed">("idle");
  const { beforeDrop } = report;

  const copy = async (kind: "json" | "text") => {
    try {
      await navigator.clipboard.writeText(
        kind === "json" ? JSON.stringify(report, null, 2) : outageReportText(report),
      );
      setCopyState(kind);
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <DetailsModal title='Outage report' onClose={onClose} size='default'>
      <div className='mt-2 flex flex-col gap-4'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='text-[16px] font-semibold text-foreground'>{causeLabel(report)}</span>
            <span className='font-mono text-[12px] whitespace-nowrap text-muted-foreground tabular-nums'>
              {formatEventDuration(report.durationMs)}
            </span>
          </div>
          <span className='text-[12.5px] text-muted-foreground'>
            {formatDateTime(report.startMs)} → {formatClockTimeShort(report.endMs)}
            <span className='text-muted-foreground/70'> · {SOURCE_LABEL[report.source]}</span>
          </span>
        </div>

        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'>
            Five minutes before the drop
          </span>
          <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]'>
            <span className='text-muted-foreground'>Latency</span>
            <span className='text-right font-mono text-foreground tabular-nums'>
              {beforeDrop.latencyAvgMs === null
                ? "not recorded"
                : `${Math.round(beforeDrop.latencyAvgMs)} ms`}
            </span>
            <span className='text-muted-foreground'>Downlink</span>
            <span className='text-right font-mono text-foreground tabular-nums'>
              {beforeDrop.downlinkAvgBps === null
                ? "not recorded"
                : formatThroughputLabel(beforeDrop.downlinkAvgBps)}
            </span>
            <span className='text-muted-foreground'>Uplink</span>
            <span className='text-right font-mono text-foreground tabular-nums'>
              {beforeDrop.uplinkAvgBps === null
                ? "not recorded"
                : formatThroughputLabel(beforeDrop.uplinkAvgBps)}
            </span>
            {beforeDrop.dropRateAvg !== null && (
              <>
                <span className='text-muted-foreground'>Packet loss</span>
                <span className='text-right font-mono text-foreground tabular-nums'>
                  {(beforeDrop.dropRateAvg * 100).toFixed(1)}%
                </span>
              </>
            )}
            <span className='text-muted-foreground'>Snow melt</span>
            <span className='text-right font-mono text-foreground tabular-nums'>
              {SNOW_MELT_LABEL[beforeDrop.snowMelt]}
            </span>
          </div>
          <span className='text-[11.5px] text-muted-foreground/80'>
            {beforeDrop.coverageSeconds} s of the window recorded
          </span>
        </div>

        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'>
            Thermal
          </span>
          {report.thermal.length === 0 ? (
            <span className='text-[13px] text-foreground'>None</span>
          ) : (
            <div className='flex flex-col gap-0.5'>
              {report.thermal.map((episode) => (
                <div
                  className='flex items-baseline justify-between gap-3 text-[13px]'
                  key={`${episode.alertKey}:${episode.startMs}`}
                >
                  <span className='text-foreground'>
                    {THERMAL_LABEL[episode.alertKey] ?? episode.alertKey}
                  </span>
                  <span className='font-mono text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
                    {formatClockTimeShort(episode.startMs)} →{" "}
                    {episode.endMs === null ? "now" : formatClockTimeShort(episode.endMs)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='flex gap-2 border-t border-border pt-3'>
          <button className={actionButton("subtle")} onClick={() => void copy("json")}>
            {copyState === "json"
              ? "Copied ✓"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy JSON"}
          </button>
          <button className={actionButton("subtle")} onClick={() => void copy("text")}>
            {copyState === "text"
              ? "Copied ✓"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy text"}
          </button>
        </div>
      </div>
    </DetailsModal>
  );
}
