// Series definitions for the dashboard charts, plus the builder that turns
// raw telemetry into the Average/Current/energy config each stat-detail sheet
// needs. Kept out of App so the component just wires data to views.

import type { ChartSeries } from "../components/TelemetryChart";
import type { StatDetail } from "../components/StatDetailPanel";
import type { TelemetrySample, OutageEvent } from "./telemetry";
import type { DishStatusJson } from "./dishClient";
import { formatThroughput, formatThroughputLabel, formatThroughputTick } from "./format";

export const THROUGHPUT_SERIES: ChartSeries[] = [
  { id: "down", label: "Download", colorVar: "--series-down", getValue: (sample) => sample.downlinkBps },
  { id: "up", label: "Upload", colorVar: "--series-up", getValue: (sample) => sample.uplinkBps },
];

export const LATENCY_SERIES: ChartSeries[] = [
  { id: "latency", label: "Latency", colorVar: "--chart-ink", getValue: (sample) => sample.latencyMs, bucketReduce: "max" },
];

export const POWER_SERIES: ChartSeries[] = [
  { id: "power", label: "Power draw", colorVar: "--chart-ink", getValue: (sample) => sample.powerW },
];

/** The tail of the series covering the last `windowMinutes` (samples are ~1/sec). */
export function windowSlice(samples: TelemetrySample[], windowMinutes: number): TelemetrySample[] {
  return samples.slice(-Math.max(1, Math.round(windowMinutes * 60)));
}

export function averageOf(samples: TelemetrySample[], getValue: (sample: TelemetrySample) => number | null): number {
  const values = samples.map(getValue).filter((value): value is number => value !== null);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Energy in kWh, integrating power over the samples (≈1s each): ΣW·s ÷ 3.6M. */
export function energyKWh(samples: TelemetrySample[]): number {
  const wattSeconds = samples.reduce((sum, sample) => sum + (sample.powerW ?? 0), 0);
  return wattSeconds / 3_600_000;
}

/** Human span actually covered by a slice, honoring that data may not reach the full window. */
export function coverageNote(slice: TelemetrySample[], windowMinutes: number): string {
  if (slice.length < 2) return "not enough data yet";
  const spanMinutes = (slice[slice.length - 1].timestampMs - slice[0].timestampMs) / 60_000;
  if (spanMinutes < windowMinutes * 0.95) {
    const rounded = spanMinutes >= 1 ? `${Math.round(spanMinutes)} min` : "< 1 min";
    return `last ${rounded} — all data available this session`;
  }
  return "over the selected window";
}

export interface StatDetailInputs {
  status: DishStatusJson | null;
  currentPowerW: number;
  outageEvents: OutageEvent[];
}

// Window-INDEPENDENT config for each detail sheet. The sheet owns its own time
// window (local to the popup) and computes the average / window-energy itself,
// so it never touches the dashboard's window state.
/** Builds the detail config for every clickable tile, keyed by tile id. */
export function buildStatDetails({ status, currentPowerW, outageEvents }: StatDetailInputs): Record<string, StatDetail> {
  return {
    download: {
      label: "Download",
      current: status?.downlinkThroughputBps ?? 0,
      formatBig: formatThroughput,
      series: [THROUGHPUT_SERIES[0]],
      formatValue: formatThroughputLabel,
      formatTick: formatThroughputTick,
      explainer:
        "Download throughput is the rate data arrives from the internet to your dish, in bits per second. It spikes while you're actively pulling data and idles near zero when nothing is downloading.",
    },
    upload: {
      label: "Upload",
      current: status?.uplinkThroughputBps ?? 0,
      formatBig: formatThroughput,
      series: [THROUGHPUT_SERIES[1]],
      formatValue: formatThroughputLabel,
      formatTick: formatThroughputTick,
      explainer:
        "Upload throughput is the rate data leaves your dish for the internet. It's typically much lower than download and rises when you send large files, back up data, or make video calls.",
    },
    latency: {
      label: "Latency",
      current: status?.popPingLatencyMs ?? 0,
      formatBig: (value) => ({ value: value.toFixed(0), unit: "ms" }),
      series: LATENCY_SERIES,
      formatValue: (value) => `${value.toFixed(0)} ms`,
      explainer:
        "Latency is the round-trip ping time from your dish to Starlink's point of presence. Lower is better; brief spikes are normal as the dish hands off between satellites.",
      outageEvents,
    },
    power: {
      label: "Power draw",
      current: currentPowerW,
      formatBig: (value) => ({ value: value.toFixed(0), unit: "W" }),
      series: POWER_SERIES,
      formatValue: (value) => `${value.toFixed(0)} W`,
      explainer:
        "Power draw is how much electricity the Starlink terminal is using. It rises under heavy load and when the dish heats itself to melt snow or ice.",
      showWindowEnergy: true,
      showEnergyHistory: true,
    },
  };
}
