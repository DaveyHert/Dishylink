// Selecting the part of the sample buffer that speaks for now: the newest
// reading, the last minute, the last ninety seconds.
//
// Every span is cut from wall-clock now. A dish that stops answering stops
// appending samples, so a span counted in readings would stand still with the
// data and go on presenting the last healthy minute as the current one — a
// figure reading 100% ping success while the dish is unreachable.

import type { TelemetrySample } from "@core/telemetry";

const LIVE_READING_MS = 5_000;
const RECENT_AVERAGE_MS = 60_000;
const SPARKLINE_MS = 90_000;

/**
 * Whether the last minute holds any reading at all.
 *
 * For the tiles whose figure is inverted from what the dish reports. Ping
 * success is drawn from the drop rate, so a minute with nothing in it averages
 * to zero drops and renders as 100% answered — the most reassuring number on
 * the dashboard, shown at the moment the dish is unreachable. A figure that
 * reads healthy when it means "no data" needs the emptiness passed separately;
 * one that reads zero can be left to say zero.
 */
export function hasRecentReadings(samples: TelemetrySample[], nowMs: number): boolean {
  const newest = samples[samples.length - 1];
  return newest !== undefined && newest.timestampMs >= nowMs - RECENT_AVERAGE_MS;
}

/** The last 90 seconds of a series, for the spark line on a stat tile. */
export function sparklineFrom(
  samples: TelemetrySample[],
  getValue: (sample: TelemetrySample) => number | null,
  nowMs: number,
) {
  const floorMs = nowMs - SPARKLINE_MS;
  let firstVisible = samples.length;
  while (firstVisible > 0 && samples[firstVisible - 1].timestampMs >= floorMs) firstVisible--;
  return samples.slice(firstVisible).map(getValue);
}

/**
 * What the dish is doing this second, for a tile that reports a live figure.
 *
 * Reads from the sample ring because power is absent from `get_status` — the
 * throughput and latency tiles can take their live value from the status reply,
 * power cannot. The ring is one sample per second with its newest entry pinned
 * to now, so its tail is the current reading.
 *
 * A missing ring entry decodes as 0 (decodeHistoryWindow), so a few seconds are
 * searched for a real one rather than reporting a dropped second as no draw.
 */
export function latestReading(
  samples: TelemetrySample[],
  getValue: (sample: TelemetrySample) => number | null,
  nowMs: number,
): number {
  const floorMs = nowMs - LIVE_READING_MS;
  for (let index = samples.length - 1; index >= 0; index--) {
    const sample = samples[index];
    if (sample.timestampMs < floorMs) break;
    const value = getValue(sample);
    if (value !== null && value > 0) return value;
  }
  return 0;
}

/**
 * Mean over the last minute of clock.
 *
 * The cut is by timestamp because a silent dish stops appending: a fixed count
 * of trailing samples would keep re-averaging the last minute before the dish
 * went quiet and report it as the current one, holding a tile at its final
 * healthy reading for as long as the outage runs. An empty minute averages to
 * zero, which on these tiles is the honest reading — no throughput moved, no
 * ping came back.
 */
export function recentAverage(
  samples: TelemetrySample[],
  getValue: (sample: TelemetrySample) => number | null,
  nowMs: number,
): number {
  const floorMs = nowMs - RECENT_AVERAGE_MS;
  const recentValues: number[] = [];
  for (let index = samples.length - 1; index >= 0; index--) {
    const sample = samples[index];
    if (sample.timestampMs < floorMs) break;
    const value = getValue(sample);
    if (value !== null) recentValues.push(value);
  }
  if (recentValues.length === 0) return 0;
  return recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length;
}
