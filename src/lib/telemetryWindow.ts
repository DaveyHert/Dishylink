// Trimming a sample buffer to the stretch a chart will actually draw.
//
// Lives apart from the chart because the callers are the ones holding the long
// buffers — the dish keeps 6h, per-device history 6h — and they trim before
// handing anything over, so the chart is never given points its own window
// filter would drop.

import type { TelemetrySample } from "@core/telemetry";

/** The tail of a series a chart would draw for `windowMinutes`. Mirrors the
 *  windowEndMs/windowStartMs pair in TelemetryChart, so the two stay in step.
 *
 *  `nowMs` is required rather than defaulted to Date.now(): callers memoize this,
 *  and a clock read hidden inside a useMemo is a window that stops advancing as
 *  soon as its other deps go quiet. Pass the ticking value from useNow, so the
 *  memo lists it as a dependency and recomputes with it. */
export function windowTail(
  samples: TelemetrySample[],
  windowMinutes: number,
  nowMs: number,
): TelemetrySample[] {
  if (samples.length === 0) return samples;
  const startMs = nowMs - windowMinutes * 60_000;
  const firstVisible = samples.findIndex((sample) => sample.timestampMs >= startMs);
  if (firstVisible === -1) return [];
  return firstVisible === 0 ? samples : samples.slice(firstVisible);
}
