// The stat drill-down opened from a tile: big Average | Current pair, a large
// time-series chart with a window picker, an optional live-window energy readout,
// and an explainer blurb. A view, not a container — App composes it into
// DetailsModal, same as the other panels.
//
// Owns its OWN time window (local state) — changing it never touches the
// dashboard's window behind it.

import { useMemo, useState } from "react";
import { TelemetryChart, type ChartSeries } from "../shared/TelemetryChart";
import { windowTail } from "../../lib/telemetryWindow";
import { LatencyHistogram } from "./LatencyHistogram";
import { EnergyHistoryPanel } from "./EnergyHistoryPanel";
import { averageOf, energyKWh, coverageNote } from "../../lib/statDetails";
import { useEnergyHistory, type EnergyRange } from "../../hooks/useEnergyHistory";
import { useNow } from "../../hooks/useNow";
import type { TelemetrySample, OutageEvent } from "@core/telemetry";
import { SegmentedControl } from "../ui/segmented-control";
import { Explainer } from "../ui/explainer";
import { EmptyState } from "../ui/empty-state";
import { FigureRow } from "../ui/figure-row";

// Window minutes → the historian's matching range, so the live-window energy
// readout can show the SAME persisted total as the "Total energy used" panel
// below it (only the historian's 1h/6h ranges line up with the picker; 15M has
// no historian range and stays a live-sample integral).
const HISTORIAN_RANGE_FOR_WINDOW: Record<number, EnergyRange> = { 60: "1h", 360: "6h" };

export interface StatDetail {
  label: string;
  /** Instantaneous value (window-independent). */
  current: number;
  /** Renders the big Average/Current numbers into value + unit. */
  formatBig: (value: number) => { value: string; unit: string };
  series: ChartSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  explainer: string;
  outageEvents?: OutageEvent[];
  /** Hard y-axis ceiling, for series with a real upper bound (percentages). */
  maxValue?: number;
  /** Show the per-series latency distribution histogram under the chart. */
  distribution?: boolean;
  /** Overrides the DetailsModal header for this detail only — its top
   *  figures/chart are one device, and a secondaryChart names the other, so the
   *  header names the first (e.g. "Starlink ping success"). `label` stays the
   *  plain noun the tile and explainer use. */
  modalTitle?: string;
  /** A related series that deserves its own chart rather than a line over the
   *  main one — a different source, or a shorter history than the main series.
   *
   *  It is the same measurement in the same unit, so it is drawn by the same
   *  chart at the same size with the same formatters and axis as the primary.
   *  Only the series (and so the colour) differs. */
  secondaryChart?: {
    title: string;
    note: string;
    series: ChartSeries[];
    /** Shown instead of the chart when nothing in this window was measured —
     *  says why, since for these series an empty window is a real answer. */
    emptyNote: string;
  };
  /** Show the live "energy used over this window" readout (Power detail only). */
  showWindowEnergy?: boolean;
  /** Show the persistent day/week/month energy section (Power detail only). */
  showEnergyHistory?: boolean;
  /** Freezes the chart's newest edge on a fixed instant (Power detail only, the
   *  5s bucket boundary), so the panel's chart steps in lockstep with the tile
   *  and the dashboard chart instead of sliding every second. */
  chartWindowEndMs?: number;
  /** Window the panel opens on (defaults to 1H). */
  defaultWindowMinutes?: number;
}

const WINDOW_CHOICES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

/** ToggleGroup values are strings; minutes stay the source of truth. */
const WINDOW_OPTIONS = WINDOW_CHOICES.map((choice) => ({
  label: choice.label,
  value: String(choice.minutes),
}));

interface StatDetailPanelProps {
  detail: StatDetail;
  samples: TelemetrySample[];
}

export function StatDetailPanel({ detail, samples }: StatDetailPanelProps) {
  // Local to the popup — decoupled from the dashboard's window. Fresh mount per
  // open (the panel unmounts on close), so this initializer picks the per-tile
  // default each time.
  const [windowMinutes, setWindowMinutes] = useState(detail.defaultWindowMinutes ?? 15);

  const getSeriesValue = detail.series[0].getValue;
  const nowMs = useNow();
  // The same function the chart clips with, so the figures below and the picture
  // above describe one stretch of time by construction. It cuts by clock, which
  // is the only thing that works here: the buffer runs at 1 Hz solely while
  // nothing interrupts it, so counting out windowMinutes × 60 samples reaches
  // back through any recording gap and averages hours the window never claimed.
  const windowed = useMemo(
    () => windowTail(samples, windowMinutes, nowMs),
    [samples, windowMinutes, nowMs],
  );
  // The power panel freezes its chart on the 5s boundary, so that chart trims to
  // the same instant — otherwise a live floor drops samples still inside the
  // frozen window and creeps its left edge every second. The figures and energy
  // below keep `windowed` (cut to now), so their math is untouched.
  const chartWindowed = detail.chartWindowEndMs
    ? windowTail(samples, windowMinutes, detail.chartWindowEndMs)
    : windowed;
  const averageValue = useMemo(
    () => averageOf(windowed, getSeriesValue),
    [windowed, getSeriesValue],
  );
  const windowEnergy = useMemo(
    () => (detail.showWindowEnergy ? energyKWh(windowed) : 0),
    [detail.showWindowEnergy, windowed],
  );

  // Prefer the persistent historian total for this window (matches the panel
  // below), falling back to the live-sample integral for 15M or when the
  // historian isn't running.
  const historianRange = HISTORIAN_RANGE_FOR_WINDOW[windowMinutes];
  const energyHistory = useEnergyHistory(
    historianRange ?? "6h",
    Boolean(detail.showWindowEnergy && historianRange),
  );
  const useHistorianEnergy = Boolean(
    historianRange && !energyHistory.unavailable && energyHistory.data,
  );
  const displayEnergyKWh = useHistorianEnergy ? energyHistory.data!.totalKWh : windowEnergy;
  const energyNote = useHistorianEnergy
    ? energyHistory.data!.coverage.fraction >= 0.95
      ? "over the selected window"
      : `recorded ${Math.round(energyHistory.data!.coverage.fraction * 100)}% of this window`
    : coverageNote(windowed, windowMinutes);

  // An empty chart is just a confusing box; say so in words until a reading
  // lands. Finite-checked, not merely non-null: a snapshot written before this
  // series existed has the field absent, which reads as undefined, not null.
  const secondaryGetValue = detail.secondaryChart?.series[0].getValue;
  const hasSecondaryData = useMemo(
    () =>
      secondaryGetValue
        ? windowed.some((sample) => Number.isFinite(secondaryGetValue(sample)))
        : false,
    [windowed, secondaryGetValue],
  );
  // The secondary series is the same measurement in the same unit as the
  // primary (see the type), so it gets the primary's formatter and its own
  // Average | Current pair — the app gives each device one, we did not. Average
  // is over the window; Current is the latest reading from the full buffer
  // (window-independent, like the primary's `current`), and is dropped when the
  // series has no reading rather than shown as a formatted zero.
  const secondaryAverage = useMemo(
    () => (secondaryGetValue ? averageOf(windowed, secondaryGetValue) : 0),
    [windowed, secondaryGetValue],
  );
  const secondaryCurrent = useMemo(() => {
    if (!secondaryGetValue) return null;
    for (let index = samples.length - 1; index >= 0; index--) {
      const value = secondaryGetValue(samples[index]);
      if (value !== null && Number.isFinite(value)) return value;
    }
    return null;
  }, [samples, secondaryGetValue]);
  const secondaryFigures = [
    { label: "Average", ...detail.formatBig(secondaryAverage) },
    ...(secondaryCurrent !== null
      ? [{ label: "Current", ...detail.formatBig(secondaryCurrent) }]
      : []),
  ];

  const current = detail.formatBig(detail.current);
  const average = detail.formatBig(averageValue);

  return (
    <>
      <FigureRow
        figures={[
          { label: "Average", value: average.value, unit: average.unit },
          { label: "Current", value: current.value, unit: current.unit },
        ]}
      />
      <SegmentedControl
        options={WINDOW_OPTIONS}
        value={String(windowMinutes)}
        onChange={(minutes) => setWindowMinutes(Number(minutes))}
        label='Time window'
        className='mb-2.5'
      />

      <TelemetryChart
        samples={chartWindowed}
        series={detail.series}
        windowMinutes={windowMinutes}
        formatValue={detail.formatValue}
        formatTick={detail.formatTick}
        outageEvents={detail.outageEvents}
        maxValue={detail.maxValue}
        windowEndMs={detail.chartWindowEndMs}
        height={220}
      />

      {/* Two lines on one axis need naming; a single line is named by the panel
          title. Same placement as the official app: dots under the chart. */}
      {detail.series.length > 1 && (
        <div className='mt-2 flex items-center justify-center gap-5'>
          {detail.series.map((chartSeries) => (
            <span
              key={chartSeries.id}
              className='inline-flex items-center gap-1.5 text-[12px] font-semibold'
            >
              <span
                className='size-[9px] flex-none rounded-full'
                style={{ background: `var(${chartSeries.colorVar})` }}
              />
              {chartSeries.label}
            </span>
          ))}
        </div>
      )}

      {detail.distribution && (
        <section className='mt-4'>
          <h3 className='text-[15px] font-semibold'>Latency distribution</h3>
          <p className='mt-0.5 mb-2 text-[12px] font-medium text-muted-foreground'>
            over the selected window
          </p>
          <LatencyHistogram samples={windowed} series={detail.series} />
        </section>
      )}

      {detail.secondaryChart && (
        <section className='mt-4'>
          <h3 className='text-[15px] font-semibold'>{detail.secondaryChart.title}</h3>
          <p className='mt-0.5 mb-2 text-[12px] font-medium text-muted-foreground'>
            {detail.secondaryChart.note}
          </p>
          {hasSecondaryData ? (
            <>
              <FigureRow className='mt-0 mb-3' size='sm' figures={secondaryFigures} />
              <TelemetryChart
                samples={windowed}
                series={detail.secondaryChart.series}
                windowMinutes={windowMinutes}
                formatValue={detail.formatValue}
                formatTick={detail.formatTick}
                outageEvents={detail.outageEvents}
                maxValue={detail.maxValue}
                height={220}
              />
            </>
          ) : (
            <EmptyState className='py-6'>{detail.secondaryChart.emptyNote}</EmptyState>
          )}
        </section>
      )}

      {detail.showWindowEnergy && (
        <div className='mt-3.5 rounded-lg bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] px-[15px] py-[13px]'>
          {/* Zero over an unmeasured window; the note underneath says which. */}
          <div className='text-[23px] font-bold'>
            {displayEnergyKWh.toFixed(displayEnergyKWh < 1 ? 3 : 2)} kWh
          </div>
          <div className='mt-0.5 text-[12px] font-medium text-muted-foreground'>
            energy used {energyNote}
          </div>
        </div>
      )}

      {detail.showEnergyHistory && <EnergyHistoryPanel active />}

      <Explainer title={`What is ${detail.label.toLowerCase()}?`}>{detail.explainer}</Explainer>
    </>
  );
}
