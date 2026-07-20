// The stat drill-down opened from a tile: big Average | Current pair, a large
// time-series chart with a window picker, an optional live-window energy readout,
// and an explainer blurb. A view, not a container — App composes it into
// DetailsModal, same as the other panels.
//
// Owns its OWN time window (local state) — changing it never touches the
// dashboard's window behind it.

import { useMemo, useState } from "react";
import { TelemetryChart, type ChartSeries } from "../shared/TelemetryChart";
import { EnergyHistoryPanel } from "./EnergyHistoryPanel";
import { windowSlice, averageOf, energyKWh, coverageNote } from "../../lib/statDetails";
import { useEnergyHistory, type EnergyRange } from "../../hooks/useEnergyHistory";
import type { TelemetrySample, OutageEvent } from "../../lib/telemetry";
import { SegmentedControl } from "../ui/segmented-control";
import { Explainer } from "../ui/explainer";
import { FigureRow } from "../ui/figure-row";

// Window minutes → the collector's matching range, so the live-window energy
// readout can show the SAME persisted total as the "Total energy used" panel
// below it (only the collector's 1h/6h ranges line up with the picker; 15M has
// no collector range and stays a live-sample integral).
const COLLECTOR_RANGE_FOR_WINDOW: Record<number, EnergyRange> = { 60: "1h", 360: "6h" };

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
  /** Show the live "energy used over this window" readout (Power detail only). */
  showWindowEnergy?: boolean;
  /** Show the persistent day/week/month energy section (Power detail only). */
  showEnergyHistory?: boolean;
  /** Window the sheet opens on (defaults to 1H). */
  defaultWindowMinutes?: number;
}

const WINDOW_CHOICES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

/** ToggleGroup values are strings; minutes stay the source of truth. */
const WINDOW_OPTIONS = WINDOW_CHOICES.map((choice) => ({ label: choice.label, value: String(choice.minutes) }));

interface StatDetailPanelProps {
  detail: StatDetail;
  samples: TelemetrySample[];
}

export function StatDetailPanel({ detail, samples }: StatDetailPanelProps) {
  // Local to the popup — decoupled from the dashboard's window. Fresh mount per
  // open (the sheet unmounts on close), so this initializer picks the per-tile
  // default each time.
  const [windowMinutes, setWindowMinutes] = useState(detail.defaultWindowMinutes ?? 15);

  const getSeriesValue = detail.series[0].getValue;
  const windowed = useMemo(() => windowSlice(samples, windowMinutes), [samples, windowMinutes]);
  const averageValue = useMemo(() => averageOf(windowed, getSeriesValue), [windowed, getSeriesValue]);
  const windowEnergy = useMemo(
    () => (detail.showWindowEnergy ? energyKWh(windowed) : 0),
    [detail.showWindowEnergy, windowed],
  );

  // Prefer the persistent collector total for this window (matches the panel
  // below), falling back to the live-sample integral for 15M or when the
  // collector isn't running.
  const collectorRange = COLLECTOR_RANGE_FOR_WINDOW[windowMinutes];
  const energyHistory = useEnergyHistory(
    collectorRange ?? "6h",
    Boolean(detail.showWindowEnergy && collectorRange),
  );
  const useCollectorEnergy = Boolean(collectorRange && !energyHistory.unavailable && energyHistory.data);
  const displayEnergyKWh = useCollectorEnergy ? energyHistory.data!.totalKWh : windowEnergy;
  const energyNote = useCollectorEnergy
    ? energyHistory.data!.coverage.fraction >= 0.95
      ? "over the selected window"
      : `collector has ${Math.round(energyHistory.data!.coverage.fraction * 100)}% of this window`
    : coverageNote(windowed, windowMinutes);

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
        label="Time window"
        className="mb-2.5"
      />

      <TelemetryChart
        samples={windowed}
        series={detail.series}
        windowMinutes={windowMinutes}
        formatValue={detail.formatValue}
        formatTick={detail.formatTick}
        outageEvents={detail.outageEvents}
        height={220}
      />

      {detail.showWindowEnergy && (
        <div className="mt-3.5 rounded-lg bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] px-[15px] py-[13px]">
          <div className="text-[23px] font-bold">{displayEnergyKWh.toFixed(displayEnergyKWh < 1 ? 3 : 2)} kWh</div>
          <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">energy used {energyNote}</div>
        </div>
      )}

      {detail.showEnergyHistory && <EnergyHistoryPanel active />}

      <Explainer title={`What is ${detail.label.toLowerCase()}?`}>{detail.explainer}</Explainer>
    </>
  );
}
