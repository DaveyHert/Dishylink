// What the dish is doing right now, derived from the sample buffer in one place.
//
// Every span here is cut from wall-clock now rather than from a count of
// trailing samples, because a dish that stops answering stops appending: a span
// counted in readings stands still with the data and goes on presenting the
// last healthy minute as the current one.
//
// `nowMs` comes back out with the readings because the chart windows are cut
// against the same instant. Two clocks read a beat apart would let a figure and
// the chart beneath it describe fractionally different moments.

import { useMemo } from "react";
import type { TelemetrySample } from "@core/telemetry";
import { useNow } from "./useNow";
import {
  powerBucketMean,
  powerBucketEndMs,
  recentAverage,
  hasRecentReadings,
  sparklineFrom,
} from "../lib/readings";

/** The 90-second trace behind each reading, for drawing as a spark line. */
export interface LiveSparklines {
  downlink: (number | null)[];
  uplink: (number | null)[];
  latency: (number | null)[];
  power: (number | null)[];
  pingSuccess: (number | null)[];
}

export interface LiveReadings {
  /** The instant every figure and chart window on the page is measured against. */
  nowMs: number;
  /**
   * Current draw for the "current draw" tile, settled into a 5-second bucket
   * mean so the figure steps every 5s instead of flickering per second.
   */
  livePowerW: number;
  /**
   * The instant the power spark line and power charts end their window on — the
   * latest completed 5s boundary. Feeding it to those (and nowhere else) freezes
   * the whole power picture between steps, so it moves with `livePowerW` rather
   * than sliding every second beneath a figure that only steps every 5s.
   */
  powerWindowEndMs: number;
  /** Mean draw over the last minute, which the kWh/day projection extrapolates. */
  averagePowerW: number;
  /** Pings answered over the last minute, as a percentage. */
  recentPingSuccessPercent: number;
  sparklines: LiveSparklines;
}

export function useLiveReadings(samples: TelemetrySample[]): LiveReadings {
  const nowMs = useNow();

  // The raw per-second draw is spiky, so the tile shows the mean of the last
  // completed 5s bucket, stepping at each boundary rather than flickering. The
  // spark line and charts end their window on the same boundary, so the whole
  // power picture steps together instead of sliding under a stepping figure.
  const powerWindowEndMs = powerBucketEndMs(nowMs);
  const livePowerW = useMemo(() => powerBucketMean(samples, nowMs), [samples, nowMs]);

  // A day's projection needs a settled figure: extrapolated from a single second
  // it would swing by whole kWh as the dish breathes.
  const averagePowerW = useMemo(
    () => recentAverage(samples, (sample) => sample.powerW, nowMs),
    [samples, nowMs],
  );

  // Success, not the drop rate it comes from. A minute holding no readings
  // averages to zero drops, and zero drops is 100% answered — a perfect score
  // shown at the moment the dish is unreachable. Derived once so the tile and
  // the detail panel cannot disagree about it.
  const recentPingSuccessPercent = useMemo(
    () =>
      hasRecentReadings(samples, nowMs)
        ? 100 - recentAverage(samples, (sample) => sample.dropRate, nowMs) * 100
        : 0,
    [samples, nowMs],
  );

  // Cut once for the set. Each tile's trace covers the same 90 seconds, so
  // they belong to one memo rather than five that re-derive the same span.
  const sparklines = useMemo<LiveSparklines>(
    () => ({
      downlink: sparklineFrom(samples, (sample) => sample.downlinkBps, nowMs),
      uplink: sparklineFrom(samples, (sample) => sample.uplinkBps, nowMs),
      latency: sparklineFrom(samples, (sample) => sample.latencyMs, nowMs),
      power: sparklineFrom(samples, (sample) => sample.powerW, powerWindowEndMs, powerWindowEndMs),
      pingSuccess: sparklineFrom(samples, (sample) => (1 - sample.dropRate) * 100, nowMs),
    }),
    [samples, nowMs, powerWindowEndMs],
  );

  return {
    nowMs,
    livePowerW,
    powerWindowEndMs,
    averagePowerW,
    recentPingSuccessPercent,
    sparklines,
  };
}
