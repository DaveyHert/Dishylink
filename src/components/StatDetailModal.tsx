// Full-screen detail sheet opened from a stat tile — mirrors the Starlink
// app's metric detail: big Average | Current pair, a large time-series chart
// with a window picker, an optional live-window energy readout, and an
// explainer blurb.
//
// The sheet owns its OWN time window (local state) — changing it never touches
// the dashboard's window behind the popup.

import { useEffect, useMemo, useState } from "react";
import { TelemetryChart, type ChartSeries } from "./TelemetryChart";
import { EnergyHistoryPanel } from "./EnergyHistoryPanel";
import { windowSlice, averageOf, energyKWh, coverageNote } from "../lib/statDetails";
import { useEnergyHistory, type EnergyRange } from "../hooks/useEnergyHistory";
import type { TelemetrySample, OutageEvent } from "../lib/telemetry";

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

interface StatDetailModalProps {
  detail: StatDetail;
  samples: TelemetrySample[];
  onClose: () => void;
}

function BigNumber({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="detail-figure">
      <div className="detail-figure-value">
        {value}
        <span className="detail-figure-unit">{unit}</span>
      </div>
      <div className="detail-figure-label">{label}</div>
    </div>
  );
}

export function StatDetailModal({ detail, samples, onClose }: StatDetailModalProps) {
  // Local to the popup — decoupled from the dashboard's window. Fresh mount per
  // open (the sheet unmounts on close), so this initializer picks the per-tile
  // default each time.
  const [windowMinutes, setWindowMinutes] = useState(detail.defaultWindowMinutes ?? 60);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="detail-overlay" onClick={onClose}>
      <div
        className="detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.label} detail`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <span className="detail-title">{detail.label}</span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="detail-figures">
          <BigNumber label="Average" value={average.value} unit={average.unit} />
          <div className="detail-figure-divider" />
          <BigNumber label="Current" value={current.value} unit={current.unit} />
        </div>

        <div className="window-picker detail-window-picker">
          {WINDOW_CHOICES.map((choice) => (
            <button
              key={choice.minutes}
              className={windowMinutes === choice.minutes ? "active" : ""}
              onClick={() => setWindowMinutes(choice.minutes)}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <TelemetryChart
          samples={samples}
          series={detail.series}
          windowMinutes={windowMinutes}
          formatValue={detail.formatValue}
          formatTick={detail.formatTick}
          outageEvents={detail.outageEvents}
          height={220}
        />

        {detail.showWindowEnergy && (
          <div className="detail-energy">
            <div className="detail-energy-total">
              {displayEnergyKWh.toFixed(displayEnergyKWh < 1 ? 3 : 2)} kWh
            </div>
            <div className="detail-energy-note">energy used {energyNote}</div>
          </div>
        )}

        {detail.showEnergyHistory && <EnergyHistoryPanel active />}

        <div className="detail-explainer">
          <div className="detail-explainer-title">What is {detail.label.toLowerCase()}?</div>
          <p>{detail.explainer}</p>
        </div>
      </div>
    </div>
  );
}
