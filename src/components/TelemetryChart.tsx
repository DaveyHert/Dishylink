// Reusable time-series chart: hairline grid, 2px round lines, 10% area wash,
// outage bands, crosshair + tooltip. Samples are bucketed per pixel.

import { useMemo, useRef, useState, useEffect, useCallback, useId } from "react";
import type { TelemetrySample, OutageEvent } from "../lib/telemetry";
import { formatClockTime } from "../lib/format";

export interface ChartSeries {
  id: string;
  label: string;
  colorVar: string;
  getValue: (sample: TelemetrySample) => number | null;
  bucketReduce?: "avg" | "max";
}

interface TelemetryChartProps {
  samples: TelemetrySample[];
  series: ChartSeries[];
  windowMinutes: number;
  formatValue: (value: number) => string;
  /** Compact formatter for y-axis ticks; defaults to formatValue. */
  formatTick?: (value: number) => string;
  height?: number;
  outageEvents?: OutageEvent[];
  areaWash?: boolean;
  /** Shortest absence that counts as a hole. Raise it for series sampled slower
   *  than 1 Hz — per-device history is per-minute, so 30s would mark every
   *  normal step as "no data". */
  minGapMs?: number;
}

interface BucketPoint {
  timestampMs: number;
  values: (number | null)[];
  /** No samples at all between the previous bucket and this one. */
  hasGapBefore: boolean;
}

const PLOT_MARGIN = { top: 8, right: 12, bottom: 22, left: 46 };

/**
 * Shortest stretch without samples that counts as a hole rather than a hiccup.
 * The default suits the dish series, which arrive at 1 Hz: anything approaching
 * a minute is real absence — the collector's machine asleep, a restart, the dish
 * unplugged — while a dropped second or two is not worth fracturing the line
 * over. Series recorded at a coarser cadence must raise this (see the
 * `minGapMs` prop), or their normal spacing reads as absence.
 */
const MIN_GAP_MS = 30_000;

interface PlotPoint {
  x: number;
  y: number;
}

/**
 * Contiguous runs of drawable points for one series, split wherever the data
 * has a hole. Joining across a hole would draw a straight line between
 * readings hours apart and pass it off as measurement.
 */
function toRuns(
  buckets: BucketPoint[],
  seriesIndex: number,
  xForTime: (timestampMs: number) => number,
  yForValue: (value: number) => number,
): PlotPoint[][] {
  const runs: PlotPoint[][] = [];
  let current: PlotPoint[] = [];
  for (const bucket of buckets) {
    const value = bucket.values[seriesIndex];
    if (value === null || bucket.hasGapBefore) {
      if (current.length > 0) runs.push(current);
      current = [];
    }
    if (value === null) continue;
    current.push({ x: xForTime(bucket.timestampMs), y: yForValue(value) });
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [containerRef, width];
}

function niceCeiling(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  for (const multiplier of [1, 1.5, 2, 2.5, 4, 5, 8, 10]) {
    if (magnitude * multiplier >= rawMax) return magnitude * multiplier;
  }
  return magnitude * 10;
}

/** The tail of a series the chart would actually draw for `windowMinutes`.
 *  Callers holding long buffers (the dish keeps 6h, per-device history 6h) pass
 *  this so the chart isn't handed points its own window filter drops. Mirrors
 *  the windowEndMs/windowStartMs pair below, so the two stay in step. */
export function windowTail(samples: TelemetrySample[], windowMinutes: number): TelemetrySample[] {
  if (samples.length === 0) return samples;
  const startMs = samples[samples.length - 1].timestampMs - windowMinutes * 60_000;
  const firstVisible = samples.findIndex((sample) => sample.timestampMs >= startMs);
  return firstVisible <= 0 ? samples : samples.slice(firstVisible);
}

export function TelemetryChart({
  samples,
  series,
  windowMinutes,
  formatValue,
  formatTick = formatValue,
  height = 190,
  outageEvents = [],
  areaWash = true,
  minGapMs = MIN_GAP_MS,
}: TelemetryChartProps) {
  const [containerRef, containerWidth] = useElementWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const washGradientId = useId();

  const plotWidth = Math.max(containerWidth - PLOT_MARGIN.left - PLOT_MARGIN.right, 50);
  const plotHeight = height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const windowEndMs = samples.length > 0 ? samples[samples.length - 1].timestampMs : Date.now();
  const windowStartMs = windowEndMs - windowMinutes * 60_000;

  const { buckets, bucketSpanMs } = useMemo<{ buckets: BucketPoint[]; bucketSpanMs: number }>(() => {
    const visibleSamples = samples.filter((sample) => sample.timestampMs >= windowStartMs);
    if (visibleSamples.length === 0) return { buckets: [], bucketSpanMs: 0 };
    const bucketCount = Math.min(Math.max(Math.floor(plotWidth / 2), 30), visibleSamples.length);
    const bucketSpanMs = (windowEndMs - windowStartMs) / bucketCount;
    const grouped: TelemetrySample[][] = Array.from({ length: bucketCount }, () => []);
    for (const sample of visibleSamples) {
      const bucketIndex = Math.min(
        Math.floor((sample.timestampMs - windowStartMs) / bucketSpanMs),
        bucketCount - 1,
      );
      grouped[bucketIndex].push(sample);
    }
    const populated = grouped
      .map((bucketSamples, bucketIndex) => {
        if (bucketSamples.length === 0) return null;
        return {
          timestampMs: windowStartMs + (bucketIndex + 0.5) * bucketSpanMs,
          values: series.map((chartSeries) => {
            const seriesValues = bucketSamples
              .map(chartSeries.getValue)
              .filter((value): value is number => value !== null && Number.isFinite(value));
            if (seriesValues.length === 0) return null;
            return chartSeries.bucketReduce === "max"
              ? Math.max(...seriesValues)
              : seriesValues.reduce((sum, value) => sum + value, 0) / seriesValues.length;
          }),
          hasGapBefore: false,
        };
      })
      .filter((bucket): bucket is BucketPoint => bucket !== null);

    // Empty buckets are dropped above, so a hole shows up as two neighbours
    // further apart than one bucket. Anything wider than that — and wider than
    // a dropped sample or two — is time we never measured.
    const gapThresholdMs = Math.max(bucketSpanMs * 1.5, minGapMs);
    for (let index = 1; index < populated.length; index++) {
      populated[index].hasGapBefore =
        populated[index].timestampMs - populated[index - 1].timestampMs > gapThresholdMs;
    }
    return { buckets: populated, bucketSpanMs };
  }, [samples, series, windowStartMs, windowEndMs, plotWidth]);

  const yMax = useMemo(() => {
    let observedMax = 0;
    for (const bucket of buckets) {
      for (const value of bucket.values) {
        if (value !== null && value > observedMax) observedMax = value;
      }
    }
    return niceCeiling(observedMax * 1.08);
  }, [buckets]);

  const xForTime = useCallback(
    (timestampMs: number) =>
      PLOT_MARGIN.left + ((timestampMs - windowStartMs) / (windowEndMs - windowStartMs)) * plotWidth,
    [windowStartMs, windowEndMs, plotWidth],
  );
  const yForValue = useCallback(
    (value: number) => PLOT_MARGIN.top + plotHeight - (value / yMax) * plotHeight,
    [plotHeight, yMax],
  );

  const baselineY = PLOT_MARGIN.top + plotHeight;
  const leftEdgeX = PLOT_MARGIN.left;

  const seriesPaths = useMemo(
    () =>
      series.map((_, seriesIndex) =>
        toRuns(buckets, seriesIndex, xForTime, yForValue)
          .map((run) => {
            const head = run[0];
            const headX = head.x.toFixed(1);
            const headY = head.y.toFixed(1);
            // Every run starts where its data starts. Running along the baseline
            // to meet the edge would draw the line at zero across time we never
            // measured — the same claim the gap break exists to avoid.
            let linePath = `M${headX},${headY}`;
            for (const point of run.slice(1)) {
              linePath += `L${point.x.toFixed(1)},${point.y.toFixed(1)}`;
            }
            // A lone point needs a zero-length segment to show up under round caps.
            if (run.length === 1) linePath += `L${headX},${headY}`;
            return linePath;
          })
          .join(""),
      ),
    [buckets, series, xForTime, yForValue],
  );

  const areaPath = useMemo(() => {
    if (!areaWash || buckets.length === 0) return "";
    // One closed shape per run, so the wash leaves the same holes as the line
    // instead of shading time we never measured.
    return toRuns(buckets, 0, xForTime, yForValue)
      .map((run) => {
        const firstX = run[0].x.toFixed(1);
        const lastX = run[run.length - 1].x.toFixed(1);
        const ground = baselineY.toFixed(1);
        const lineSegment = run.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("");
        // Each run's fill spans only its own data, matching the line.
        return `M${firstX},${ground}${lineSegment}L${lastX},${ground}Z`;
      })
      .join("");
  }, [areaWash, buckets, baselineY, xForTime, yForValue]);

  /**
   * Stretches of the window with no readings at all, named rather than drawn
   * through. Includes a hole at the left edge when the record starts partway
   * into the window: the chart shows six hours because you asked for six hours,
   * not because six hours were measured.
   */
  const gapRegions = useMemo(() => {
    if (buckets.length === 0) return [];
    const gapThresholdMs = Math.max(bucketSpanMs * 1.5, minGapMs);
    const regions: { startMs: number; endMs: number }[] = [];
    if (buckets[0].timestampMs - windowStartMs > gapThresholdMs) {
      regions.push({ startMs: windowStartMs, endMs: buckets[0].timestampMs });
    }
    for (let index = 1; index < buckets.length; index++) {
      if (buckets[index].hasGapBefore) {
        regions.push({ startMs: buckets[index - 1].timestampMs, endMs: buckets[index].timestampMs });
      }
    }
    return regions;
  }, [buckets, bucketSpanMs, windowStartMs]);

  const yTickValues = useMemo(() => {
    const tickStep = niceCeiling(yMax / 4);
    const ticks: number[] = [];
    for (let tickValue = tickStep; tickValue <= yMax * 1.001; tickValue += tickStep) ticks.push(tickValue);
    return ticks;
  }, [yMax]);
  const xTickTimes = [0.25, 0.5, 0.75].map((fraction) => windowStartMs + (windowEndMs - windowStartMs) * fraction);

  // Only events that occupy a stretch of time shade the chart. The router's log
  // carries point-in-time entries (power cycle, band switch) with no duration,
  // and the band renderer floors every band at 2px — so without this they paint
  // a red critical hairline on a chart whose caption reads "red bands = outages".
  // Duration, not severity: the dish's own "outage booting" is advisory too.
  const visibleOutages = outageEvents.filter(
    (outage) =>
      outage.durationMs > 0 &&
      outage.startMs + outage.durationMs > windowStartMs &&
      outage.startMs < windowEndMs,
  );

  // How far the crosshair may reach for a reading. Inside a hole the nearest
  // one can be hours away, and reporting it under the cursor would state a
  // measurement for a moment nothing was measured.
  const maxSnapPx = Math.max((bucketSpanMs / (windowEndMs - windowStartMs)) * plotWidth * 1.5, 8);

  const handlePointerMove = (moveEvent: React.PointerEvent<SVGSVGElement>) => {
    if (buckets.length === 0) return;
    const svgRect = moveEvent.currentTarget.getBoundingClientRect();
    const pointerX = moveEvent.clientX - svgRect.left;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    buckets.forEach((bucket, bucketIndex) => {
      const distance = Math.abs(xForTime(bucket.timestampMs) - pointerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = bucketIndex;
      }
    });
    setHoverIndex(nearestDistance > maxSnapPx ? null : nearestIndex);
  };

  const hoveredBucket = hoverIndex !== null ? buckets[hoverIndex] : null;
  const tooltipOnLeft = hoveredBucket !== null && xForTime(hoveredBucket.timestampMs) > containerWidth * 0.62;

  return (
    <div className="relative" ref={containerRef}>
      <svg
        width={containerWidth}
        height={height}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* Starlink-style wash: series color fading to transparent below the line */}
        <defs>
          <linearGradient id={washGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(${series[0].colorVar})`} stopOpacity={0.28} />
            <stop offset="100%" stopColor={`var(${series[0].colorVar})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* hairline grid + y ticks */}
        {yTickValues.map((tickValue) => (
          <g key={tickValue}>
            <line
              x1={PLOT_MARGIN.left}
              x2={PLOT_MARGIN.left + plotWidth}
              y1={yForValue(tickValue)}
              y2={yForValue(tickValue)}
              stroke="var(--hairline)"
              strokeWidth={1}
            />
            <text
              x={PLOT_MARGIN.left - 7}
              y={yForValue(tickValue) + 3}
              textAnchor="end"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--ink-muted)"
            >
              {formatTick(tickValue)}
            </text>
          </g>
        ))}
        {/* baseline */}
        <line
          x1={PLOT_MARGIN.left}
          x2={PLOT_MARGIN.left + plotWidth}
          y1={PLOT_MARGIN.top + plotHeight}
          y2={PLOT_MARGIN.top + plotHeight}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        {/* x time ticks */}
        {xTickTimes.map((tickTime) => (
          <text
            key={tickTime}
            x={xForTime(tickTime)}
            y={height - 6}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--ink-muted)"
          >
            {formatClockTime(tickTime).slice(0, 5)}
          </text>
        ))}
        {/* outage bands */}
        {visibleOutages.map((outage, outageIndex) => {
          const bandStartX = Math.max(xForTime(outage.startMs), PLOT_MARGIN.left);
          const bandEndX = Math.min(xForTime(outage.startMs + outage.durationMs), PLOT_MARGIN.left + plotWidth);
          return (
            <rect
              key={outageIndex}
              x={bandStartX}
              y={PLOT_MARGIN.top}
              width={Math.max(bandEndX - bandStartX, 2)}
              height={plotHeight}
              fill="var(--status-critical)"
              opacity={0.09}
            />
          );
        })}
        {/* no-data bands: name the hole, so absence reads as deliberate rather
            than as a chart that failed to draw */}
        {gapRegions.map((region) => {
          const bandStartX = Math.max(xForTime(region.startMs), leftEdgeX);
          const bandEndX = Math.min(xForTime(region.endMs), leftEdgeX + plotWidth);
          const bandWidth = bandEndX - bandStartX;
          if (bandWidth <= 0) return null;
          return (
            <g key={region.startMs}>
              <rect
                x={bandStartX}
                y={PLOT_MARGIN.top}
                width={bandWidth}
                height={plotHeight}
                fill="var(--ink-muted)"
                opacity={0.06}
              />
              {bandWidth > 54 && (
                <text
                  x={bandStartX + bandWidth / 2}
                  y={PLOT_MARGIN.top + plotHeight / 2}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-muted)"
                >
                  no data
                </text>
              )}
            </g>
          );
        })}
        {/* area wash for the first series */}
        {areaPath && <path d={areaPath} fill={`url(#${washGradientId})`} />}
        {/* series lines */}
        {seriesPaths.map((linePath, seriesIndex) => (
          <path
            key={series[seriesIndex].id}
            d={linePath}
            fill="none"
            stroke={`var(${series[seriesIndex].colorVar})`}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* crosshair + markers */}
        {hoveredBucket && (
          <g>
            <line
              x1={xForTime(hoveredBucket.timestampMs)}
              x2={xForTime(hoveredBucket.timestampMs)}
              y1={PLOT_MARGIN.top}
              y2={PLOT_MARGIN.top + plotHeight}
              stroke="var(--baseline)"
              strokeWidth={1}
            />
            {hoveredBucket.values.map((value, seriesIndex) =>
              value === null ? null : (
                <circle
                  key={series[seriesIndex].id}
                  cx={xForTime(hoveredBucket.timestampMs)}
                  cy={yForValue(value)}
                  r={4.5}
                  fill={`var(${series[seriesIndex].colorVar})`}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ),
            )}
          </g>
        )}
      </svg>

      {hoveredBucket && (
        <div
          className="pointer-events-none absolute z-10 min-w-[138px] rounded-md bg-popover px-[11px] py-[9px] font-mono text-[11px] shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
          style={{
            left: tooltipOnLeft ? undefined : xForTime(hoveredBucket.timestampMs) + 12,
            right: tooltipOnLeft ? containerWidth - xForTime(hoveredBucket.timestampMs) + 12 : undefined,
            top: PLOT_MARGIN.top + 4,
          }}
        >
          <div className="mb-[5px] text-[10px] tracking-[0.05em] text-muted-foreground">{formatClockTime(hoveredBucket.timestampMs)}</div>
          {series.map((chartSeries, seriesIndex) => (
            <div className="flex items-center justify-between gap-[7px] leading-[1.7]" key={chartSeries.id}>
              <span className="inline-flex items-center gap-1.5 text-[var(--ink-secondary)]">
                <span className="series-swatch" style={{ background: `var(${chartSeries.colorVar})` }} />
                {chartSeries.label}
              </span>
              <span className="font-mono tabular-nums">
                {hoveredBucket.values[seriesIndex] === null
                  ? "—"
                  : formatValue(hoveredBucket.values[seriesIndex]!)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
