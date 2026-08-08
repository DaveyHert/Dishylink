// The Latency screen's distribution histogram, as the official app draws it:
// 2 ms bins from 0–100 ms plus one overflow bar, y = share of samples in the
// bin. One panel per series — the app gives each device its own screen; this
// panel stacks them on a shared scale — so the dish's tight cluster and the
// router's longer tail read separately instead of overprinting.
//
// The app's window is "since the hardware booted" (cloud-recorded); ours is
// the panel's selected window, which is the honest equivalent of what the
// recorder actually holds.

import { useMemo } from "react";
import type { TelemetrySample } from "@core/telemetry";
import type { ChartSeries } from "../shared/TelemetryChart";
import { binLatencies } from "../../lib/latencyBins";

export function LatencyHistogram({
  samples,
  series,
}: {
  samples: TelemetrySample[];
  series: ChartSeries[];
}) {
  const panels = useMemo(
    () =>
      series
        .map((chartSeries) => ({
          series: chartSeries,
          bins: binLatencies(
            samples
              .map(chartSeries.getValue)
              .filter((value): value is number => value !== null && Number.isFinite(value)),
          ),
        }))
        // A series with nothing in the window contributes no panel — a row of
        // zero-height bars would just be a mystery gap with an axis.
        .filter((panel) => panel.bins.some((pct) => pct > 0)),
    [samples, series],
  );
  if (panels.length === 0) return null;

  // One scale across panels, so the two shapes are comparable at a glance.
  const maxPct = Math.max(...panels.flatMap((panel) => panel.bins));

  return (
    <div>
      {panels.map(({ series: chartSeries, bins }) => (
        // The chart's legend already maps colour to device and the bars carry
        // that same tint, so the panel needs no visible label — only the shared
        // scale's ceiling, set on the left to echo the chart's top y-tick. The
        // aria-label keeps the device name for readers who can't see the tint.
        <div
          key={chartSeries.id}
          className='mt-2'
          aria-label={`${chartSeries.label} latency distribution, peak ${maxPct.toFixed(1)}% of samples in one bin`}
        >
          <div className='text-[11px] font-medium font-mono tabular-nums text-muted-foreground'>
            {maxPct.toFixed(1)}% max
          </div>
          <div className='mt-1 flex h-[85px]  items-end gap-[1px]' aria-hidden='true'>
            {bins.map((pct, binIndex) => (
              <div
                key={binIndex}
                className='flex-1  rounded-t-[1px]'
                style={{
                  background: `var(${chartSeries.colorVar})`,
                  // A populated bin never rounds to invisible: the overflow
                  // bar's handful of spikes is exactly what the eye is here for.
                  height: pct > 0 ? `${Math.max((pct / maxPct) * 100, 2)}%` : 0,
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
          <div className='flex justify-between border-t border-hairline pt-1 font-mono text-[10px] text-muted-foreground'>
            <span>0 ms</span>
            <span>50 ms</span>
            <span>100+ ms</span>
          </div>
        </div>
      ))}
    </div>
  );
}
