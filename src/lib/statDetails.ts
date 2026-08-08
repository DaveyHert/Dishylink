// Series definitions for the dashboard charts, plus the builder that turns
// raw telemetry into the Average/Current/energy config each stat-detail panel
// needs. Kept out of App so the component just wires data to views.

import type { ChartSeries } from "../components/shared/TelemetryChart";
import type { StatDetail } from "../components/dashboard/StatDetailPanel";
import { readRouterLatencyMs, type TelemetrySample, type OutageEvent } from "@core/telemetry";
import type { DishStatusJson } from "@core/dishClient";
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
// that RPC rebooted the router at every cadence tried (see collector/historian.mts).
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
// unplugged, laptop on another network, historian down — is gone for good, and
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

/** A step longer than this is an outage, not a missed reading: the dish's ring
 *  advances at 1 Hz, so a few dropped samples still count as covered time. */
const COVERAGE_GAP_MS = 5_000;

/**
 * Energy in kWh: ΣW·Δt, with Δt taken from the timestamps.
 *
 * The cadence belongs to the dish's firmware, not to this code, so it is read
 * per step rather than held as a constant here. A cadence that shifted would
 * scale every figure by the same wrong ratio while every figure went on looking
 * entirely reasonable.
 *
 * A step long enough to be an outage contributes nothing. The dish drew power
 * through it, but none of that was measured, and the one stretch nothing is
 * known about is the last place to put a number.
 */
export function energyKWh(samples: TelemetrySample[]): number {
  let wattMilliseconds = 0;
  for (let index = 1; index < samples.length; index++) {
    const stepMs = samples[index].timestampMs - samples[index - 1].timestampMs;
    if (stepMs <= 0 || stepMs > COVERAGE_GAP_MS) continue;
    wattMilliseconds += (samples[index - 1].powerW ?? 0) * stepMs;
  }
  return wattMilliseconds / 3_600_000_000;
}

/**
 * How much of the window was actually recorded.
 *
 * Coverage is the sum of the steps between readings, with steps too long to be
 * readings dropped. What survives is time the dish was actually observed,
 * wherever in the window it falls. The width from the first reading to the last
 * cannot tell a full window from one with a ten-minute hole in the middle —
 * both measure the same across. Phrased like the historian-backed note beside
 * it, so the two read alike.
 */
export function coverageNote(slice: TelemetrySample[], windowMinutes: number): string {
  // No readings in the window at all — the dish has been silent for longer than
  // the window is wide. Distinct from a thin window, which is a real if short
  // measurement and reports the minutes it has.
  if (slice.length === 0) return "nothing recorded in this window";
  let coveredMs = 0;
  for (let index = 1; index < slice.length; index++) {
    const step = slice[index].timestampMs - slice[index - 1].timestampMs;
    if (step <= COVERAGE_GAP_MS) coveredMs += step;
  }
  const windowMs = windowMinutes * 60_000;
  if (coveredMs >= windowMs * 0.95) return "over the selected window";
  const coveredMinutes = coveredMs / 60_000;
  const rounded = coveredMinutes >= 1 ? `${Math.round(coveredMinutes)} min` : "< 1 min";
  return `recorded ${rounded} of this window`;
}

export interface StatDetailInputs {
  status: DishStatusJson | null;
  currentPowerW: number;
  /** The 5s bucket boundary the power figure settled on, so the panel's power
   *  chart freezes its window on the same instant and steps with the tile. */
  powerWindowEndMs: number;
  /** Pings answered over the last minute, as a percentage, matching the tile's
   *  own readout. Success rather than the drop rate it derives from: a minute
   *  with no readings in it averages to zero drops, and zero drops reads as 100%
   *  answered — a perfect score at the moment the dish is unreachable. Derived
   *  once by the caller so no surface has to remember that on its own. */
  recentPingSuccessPercent: number;
  outageEvents: OutageEvent[];
}

// Window-INDEPENDENT config for each detail panel. The panel owns its own time
// window (local to the popup) and computes the average / window-energy itself,
// so it never touches the dashboard's window state.
/** Builds the detail config for every clickable tile, keyed by tile id. */
export function buildStatDetails({
  status,
  currentPowerW,
  powerWindowEndMs,
  recentPingSuccessPercent,
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
      current: readRouterLatencyMs(status?.popPingLatencyMs) ?? 0,
      formatBig: (value) => ({ value: value.toFixed(0), unit: "ms" }),
      series: LATENCY_DETAIL_SERIES,
      formatValue: (value) => `${value.toFixed(0)} ms`,
      explainer:
        "The Starlink dish and router both send test pings to the internet many times per minute. Latency measures how long, in milliseconds, a request takes to go to the internet and back. High latency may impact your experience with online gaming, video calls, and web browsing. It may be caused by extreme weather or periods of high network usage.",
      outageEvents,
      distribution: true,
    },
    pingSuccess: {
      label: "Ping success",
      current: recentPingSuccessPercent,
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
      chartWindowEndMs: powerWindowEndMs,
    },
  };
}
