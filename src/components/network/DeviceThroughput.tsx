// Per-device download/upload charts with their own window picker.
//
// Two separate charts rather than one with two series: a device's upload is
// routinely two orders of magnitude below its download, and on a shared axis the
// upload line sits flat on the floor.

import { useMemo, useState } from "react";
import { formatThroughputLabel, formatThroughputTick } from "../../lib/format";
import { THROUGHPUT_SERIES } from "../../lib/statDetails";
import type { TelemetrySample } from "@core/telemetry";
import { InfoDot } from "../shared/InfoDot";
import { TelemetryChart, type ChartSeries } from "../shared/TelemetryChart";
import { windowTail } from "../../lib/telemetryWindow";
import { useNow } from "../../hooks/useNow";
import { SegmentedControl } from "../ui/segmented-control";
import { SectionHeading } from "./DataRow";
import { PER_DEVICE_GAP_MS, WINDOW_OPTIONS } from "./networkFormat";

// Stable references so TelemetryChart's bucket-binning memo isn't invalidated
// by a fresh array on every render (on top of the live window edge it already
// recomputes for each tick).
const DOWNLOAD_SERIES: ChartSeries[] = [THROUGHPUT_SERIES[0]];
const UPLOAD_SERIES: ChartSeries[] = [THROUGHPUT_SERIES[1]];

export function DeviceThroughput({
  history,
  downMbps,
  upMbps,
  historianAnswering,
  routerReachable,
}: {
  history: TelemetrySample[];
  /** Live headline rates. Null where nothing is measuring them, which is not the
   *  same as measuring zero. */
  downMbps: number | null;
  upMbps: number | null;
  historianAnswering: boolean | null;
  routerReachable: boolean | null;
}) {
  const [windowMinutes, setWindowMinutes] = useState(15);
  const nowMs = useNow();
  // The hook retains 6h per device; the charts draw one window of it.
  const chartHistory = useMemo(
    () => windowTail(history, windowMinutes, nowMs),
    [history, windowMinutes, nowMs],
  );
  const canDrawCharts = history.length >= 2 && chartHistory.length >= 2;
  // Keyed on having nothing to show rather than on either feed's last answer, so
  // one missed poll does not blink the tip out.
  const recordingStopped =
    !canDrawCharts && (historianAnswering === false || routerReachable === false);

  return (
    <>
      <SectionHeading title='Throughput'>
        {!recordingStopped && (
          <InfoDot tip='How much data this device is transferring right now. Stream a video and watch it jump.' />
        )}
        {history.length >= 2 && (
          <SegmentedControl
            options={WINDOW_OPTIONS}
            value={String(windowMinutes)}
            onChange={(minutes) => setWindowMinutes(Number(minutes))}
            label='Chart time window'
            className='ml-auto'
          />
        )}
      </SectionHeading>
      {!canDrawCharts ? (
        <div className='text-[11.5px] font-medium text-muted-foreground py-3.5'>
          {history.length < 2
            ? noHistoryMessage(historianAnswering, routerReachable)
            : outsideWindowMessage(windowMinutes)}
        </div>
      ) : (
        <>
          <DirectionChart
            label='Download'
            liveBps={downMbps === null ? null : downMbps * 1_000_000}
            series={DOWNLOAD_SERIES}
            samples={chartHistory}
            windowMinutes={windowMinutes}
          />
          <DirectionChart
            label='Upload'
            liveBps={upMbps === null ? null : upMbps * 1_000_000}
            series={UPLOAD_SERIES}
            samples={chartHistory}
            windowMinutes={windowMinutes}
          />
        </>
      )}
    </>
  );
}

function outsideWindowMessage(windowMinutes: number): string {
  const longestWindowMinutes = Number(WINDOW_OPTIONS[WINDOW_OPTIONS.length - 1].value);
  const windowSpanLabel =
    windowMinutes < 60
      ? `${windowMinutes} minutes`
      : `${windowMinutes / 60} hour${windowMinutes === 60 ? "" : "s"}`;
  return windowMinutes >= longestWindowMinutes
    ? `Nothing recorded for this device in the last ${windowSpanLabel}.`
    : `Nothing recorded for this device in the last ${windowSpanLabel}. Its earlier readings are kept, so a longer window still has them.`;
}

function noHistoryMessage(
  historianAnswering: boolean | null,
  routerReachable: boolean | null,
): string {
  const noRecorder = historianAnswering === false;
  const noRouter = routerReachable === false;
  if (noRecorder && noRouter) {
    return "No throughput history. The history recorder isn't running, and the router on your network can't be reached.";
  }
  if (noRecorder) {
    return "No throughput history. The history recorder isn't running, so nothing is being recorded.";
  }
  if (noRouter) {
    return "No throughput history. Per-device rates are read from the router on your network, which can't be reached right now.";
  }
  return "Collecting live throughput… charts fill in as the router is polled (every 5 s).";
}

function DirectionChart({
  label,
  liveBps,
  series,
  samples,
  windowMinutes,
}: {
  label: string;
  liveBps: number | null;
  series: ChartSeries[];
  samples: TelemetrySample[];
  windowMinutes: number;
}) {
  return (
    <div className='mb-3.5'>
      <div className='mb-0.5 flex items-baseline justify-between'>
        <span className='text-[11.5px] font-medium text-muted-foreground'>{label}</span>
        <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
          {liveBps === null ? "—" : formatThroughputLabel(liveBps)}
        </span>
      </div>
      <TelemetryChart
        samples={samples}
        series={series}
        windowMinutes={windowMinutes}
        formatValue={formatThroughputLabel}
        formatTick={formatThroughputTick}
        minGapMs={PER_DEVICE_GAP_MS}
        // Per-device rates are honest per-second readings, so the line is
        // naturally spiky; give it air (a 12 Mbps peak draws on a ~20 axis)
        // so real traffic reads as busy, not as pinned at the ceiling.
        headroom={1.7}
        height={140}
      />
    </div>
  );
}
