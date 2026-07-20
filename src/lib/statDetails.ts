// Series definitions for the dashboard charts, plus the builder that turns
// raw telemetry into the Average/Current/energy config each stat-detail sheet
// needs. Kept out of App so the component just wires data to views.

import type { ChartSeries } from "../components/shared/TelemetryChart";
import type { StatDetail } from "../components/dashboard/StatDetailPanel";
import type { TelemetrySample, OutageEvent } from "./telemetry";
import type { DishStatusJson } from "./dishClient";
import { formatThroughput, formatThroughputLabel, formatThroughputTick } from "./format";

export const THROUGHPUT_SERIES: ChartSeries[] = [
  {
    id: "down",
    label: "Download",
    colorVar: "--series-down",
    getValue: (sample) => sample.downlinkBps,
  },
  { id: "up", label: "Upload", colorVar: "--series-up", getValue: (sample) => sample.uplinkBps },
];

export const LATENCY_SERIES: ChartSeries[] = [
  {
    id: "latency",
    label: "Latency",
    colorVar: "--chart-ink",
    getValue: (sample) => sample.latencyMs,
    bucketReduce: "max",
  },
];

// Router → internet ping success, from get_status's popPingDropRate5m: the
// router's own rolling five-minute measure of its pings to the PoP, riding the
// status reply every poller already fetches. Never sourced from get_ping —
// that RPC rebooted the router at every cadence tried (see server/collector.mts).
//
// Averaged, NOT min-bucketed like the dish's series: the value is already a
// five-minute mean, so min-bucketing would smear the window's worst moment
// across five minutes of chart and call it an outage.
export const ROUTER_PING_SUCCESS_SERIES: ChartSeries[] = [
  {
    id: "router-ping-success",
    label: "Router",
    colorVar: "--chart-warm",
    getValue: (sample) => sample.routerPingSuccessPercent,
  },
];

// The latency detail overlays both opinions of the same round trip on one
// chart, the way the official app draws them — white Starlink line, orange
// Router line, one axis — with a legend naming the pair.
//
// The router's line is averaged, not maxed: the reading is already a jittery
// point-in-time sample, and maxing a bucket of them draws spikes that were
// never a real round trip.
//
// The router's line breaks where the dish's does not, and that is the data,
// not the chart: the dish replays a 900-second ring on every poll, so a
// stretch we missed is backfilled on reconnect, while the router gives one
// instantaneous float and keeps no ring. Time nobody was sampling — router
// unplugged, laptop on another network, collector down — is gone for good, and
// is drawn as the gap it is rather than a line pretending we measured.
export const LATENCY_DETAIL_SERIES: ChartSeries[] = [
  {
    id: "latency",
    label: "Starlink",
    colorVar: "--chart-ink",
    getValue: (sample) => sample.latencyMs,
    bucketReduce: "max",
  },
  {
    id: "router-latency",
    label: "Router",
    colorVar: "--chart-warm",
    getValue: (sample) => sample.routerLatencyMs,
  },
];

// Drop rate inverted into the "% of pings answered" the app shows. Bucketed by
// min so a dip survives being averaged into a window — a brief total loss is the
// whole point of the chart.
export const PING_SUCCESS_SERIES: ChartSeries[] = [
  {
    id: "ping-success",
    label: "Ping success",
    colorVar: "--chart-ink",
    getValue: (sample) => (1 - sample.dropRate) * 100,
    bucketReduce: "min",
  },
];

export const POWER_SERIES: ChartSeries[] = [
  {
    id: "power",
    label: "Power draw",
    colorVar: "--chart-ink",
    getValue: (sample) => sample.powerW,
  },
];

/** The tail of the series covering the last `windowMinutes` (samples are ~1/sec). */
export function windowSlice(samples: TelemetrySample[], windowMinutes: number): TelemetrySample[] {
  return samples.slice(-Math.max(1, Math.round(windowMinutes * 60)));
}

export function averageOf(
  samples: TelemetrySample[],
  getValue: (sample: TelemetrySample) => number | null,
): number {
  // Finite-checked, not merely non-null: samples seeded from a recorder build
  // that predates a field leave it undefined, which must not poison the mean.
  const values = samples
    .map(getValue)
    .filter((value): value is number => value !== null && Number.isFinite(value));
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
  /** Mean drop rate over the last minute, matching the tile's own readout. */
  recentDropRate: number;
  outageEvents: OutageEvent[];
}

// Window-INDEPENDENT config for each detail sheet. The sheet owns its own time
// window (local to the popup) and computes the average / window-energy itself,
// so it never touches the dashboard's window state.
/** Builds the detail config for every clickable tile, keyed by tile id. */
export function buildStatDetails({
  status,
  currentPowerW,
  recentDropRate,
  outageEvents,
}: StatDetailInputs): Record<string, StatDetail> {
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
      series: LATENCY_DETAIL_SERIES,
      formatValue: (value) => `${value.toFixed(0)} ms`,
      explainer: `Starlink and the Starlink router both send test pings to the internet many times per minute. Latency measures how long, in milliseconds, a request takes to go to the internet and back. 
        
        High latency may impact your experience with online gaming, video calls, and web browsing. It may be caused by extreme weather or periods of high network usage. Latency is the round-trip ping time from your dish to Starlink's point of presence.`,
      outageEvents,
      distribution: true,
    },
    pingSuccess: {
      label: "Ping success",
      current: (1 - recentDropRate) * 100,
      formatBig: (value) => ({ value: value.toFixed(2), unit: "%" }),
      series: PING_SUCCESS_SERIES,
      formatValue: (value) => `${value.toFixed(2)} %`,
      formatTick: (value) => `${value.toFixed(0)}%`,
      maxValue: 100,
      explainer:
        "Starlink and the Starlink router both send test pings to the internet many times per minute. It is normal for a few pings to drop without your connection noticeably suffering. Sustained dips are what matter, and they line up with the outages marked on the chart.",
      outageEvents,
      modalTitle: "Starlink ping success",
      secondaryChart: {
        title: "Router ping success",
        note: "the router's own pings to its point of presence, over a rolling five minutes",
        // Both absences look the same in the data, so the message claims neither.
        emptyNote:
          "nothing recorded in this window — the router wasn't answering, or nothing was running to record it",
        series: ROUTER_PING_SUCCESS_SERIES,
      },
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
