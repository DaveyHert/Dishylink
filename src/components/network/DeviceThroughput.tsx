// Per-device download/upload charts with their own window picker.
//
// Two separate charts rather than one with two series: a device's upload is
// routinely two orders of magnitude below its download, and on a shared axis the
// upload line sits flat on the floor.

import { useMemo, useState } from "react";
import { formatThroughputLabel, formatThroughputTick } from "../../lib/format";
import { THROUGHPUT_SERIES } from "../../lib/statDetails";
import type { TelemetrySample } from "../../lib/telemetry";
import { InfoDot } from "../shared/InfoDot";
import { TelemetryChart, windowTail } from "../shared/TelemetryChart";
import { SegmentedControl } from "../ui/segmented-control";
import { SectionHeading } from "./DataRow";
import { PER_DEVICE_GAP_MS, WINDOW_OPTIONS } from "./networkFormat";

export function DeviceThroughput({
  history,
  downMbps,
  upMbps,
}: {
  history: TelemetrySample[];
  /** Live headline rates, shown above each chart. */
  downMbps: number;
  upMbps: number;
}) {
  const [windowMinutes, setWindowMinutes] = useState(15);
  // The hook retains 6h per device; the charts draw one window of it.
  const chartHistory = useMemo(() => windowTail(history, windowMinutes), [history, windowMinutes]);

  return (
    <>
      <SectionHeading title='Throughput'>
        <InfoDot tip='How much data this device is transferring right now. Stream a video and watch it jump.' />
        <SegmentedControl
          options={WINDOW_OPTIONS}
          value={String(windowMinutes)}
          onChange={(minutes) => setWindowMinutes(Number(minutes))}
          label='Chart time window'
          className='ml-auto'
        />
      </SectionHeading>
      {history.length < 2 ? (
        <div className='text-[11.5px] font-medium text-muted-foreground py-3.5'>
          Collecting live throughput… charts fill in as the router is polled (every 5 s).
        </div>
      ) : (
        <>
          <DirectionChart
            label='Download'
            liveBps={downMbps * 1_000_000}
            series={THROUGHPUT_SERIES[0]}
            samples={chartHistory}
            windowMinutes={windowMinutes}
          />
          <DirectionChart
            label='Upload'
            liveBps={upMbps * 1_000_000}
            series={THROUGHPUT_SERIES[1]}
            samples={chartHistory}
            windowMinutes={windowMinutes}
          />
        </>
      )}
    </>
  );
}

function DirectionChart({
  label,
  liveBps,
  series,
  samples,
  windowMinutes,
}: {
  label: string;
  liveBps: number;
  series: (typeof THROUGHPUT_SERIES)[number];
  samples: TelemetrySample[];
  windowMinutes: number;
}) {
  return (
    <div className='mb-3.5'>
      <div className='mb-0.5 flex items-baseline justify-between'>
        <span className='text-[11.5px] font-medium text-muted-foreground'>{label}</span>
        <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
          {formatThroughputLabel(liveBps)}
        </span>
      </div>
      <TelemetryChart
        samples={samples}
        series={[series]}
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
