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
}

interface BucketPoint {
  timestampMs: number;
  values: (number | null)[];
}

const PLOT_MARGIN = { top: 8, right: 12, bottom: 22, left: 46 };

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

export function TelemetryChart({
  samples,
  series,
  windowMinutes,
  formatValue,
  formatTick = formatValue,
  height = 190,
  outageEvents = [],
  areaWash = true,
}: TelemetryChartProps) {
  const [containerRef, containerWidth] = useElementWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const washGradientId = useId();

  const plotWidth = Math.max(containerWidth - PLOT_MARGIN.left - PLOT_MARGIN.right, 50);
  const plotHeight = height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const windowEndMs = samples.length > 0 ? samples[samples.length - 1].timestampMs : Date.now();
  const windowStartMs = windowEndMs - windowMinutes * 60_000;

  const buckets = useMemo<BucketPoint[]>(() => {
    const visibleSamples = samples.filter((sample) => sample.timestampMs >= windowStartMs);
    if (visibleSamples.length === 0) return [];
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
    return grouped
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
        };
      })
      .filter((bucket): bucket is BucketPoint => bucket !== null);
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
      series.map((_, seriesIndex) => {
        let linePath = "";
        let pathOpen = false;
        let firstPointDrawn = false;
        for (const bucket of buckets) {
          const value = bucket.values[seriesIndex];
          if (value === null) {
            pathOpen = false;
            continue;
          }
          const pointX = xForTime(bucket.timestampMs).toFixed(1);
          const pointY = yForValue(value).toFixed(1);
          if (!pathOpen && !firstPointDrawn) {
            // Emerge from the ground: run flat along the baseline from the left
            // edge to where data begins, then rise into the first sample — so
            // the line never materializes floating in mid-air.
            linePath += `M${leftEdgeX.toFixed(1)},${baselineY.toFixed(1)}L${pointX},${baselineY.toFixed(1)}L${pointX},${pointY}`;
          } else {
            linePath += `${pathOpen ? "L" : "M"}${pointX},${pointY}`;
          }
          pathOpen = true;
          firstPointDrawn = true;
        }
        return linePath;
      }),
    [buckets, series, xForTime, yForValue, baselineY, leftEdgeX],
  );

  const areaPath = useMemo(() => {
    if (!areaWash || buckets.length === 0) return "";
    const firstSeriesPoints = buckets.filter((bucket) => bucket.values[0] !== null);
    if (firstSeriesPoints.length === 0) return "";
    const lineSegment = firstSeriesPoints
      .map(
        (bucket) => `L${xForTime(bucket.timestampMs).toFixed(1)},${yForValue(bucket.values[0]!).toFixed(1)}`,
      )
      .join("");
    const firstX = xForTime(firstSeriesPoints[0].timestampMs).toFixed(1);
    const lastX = xForTime(firstSeriesPoints[firstSeriesPoints.length - 1].timestampMs).toFixed(1);
    // Match the line: fill from the ground at the left edge, run flat to the
    // data start, then up through the series and back down to the baseline.
    return `M${leftEdgeX.toFixed(1)},${baselineY.toFixed(1)}L${firstX},${baselineY.toFixed(1)}${lineSegment}L${lastX},${baselineY.toFixed(1)}Z`;
  }, [areaWash, buckets, baselineY, leftEdgeX, xForTime, yForValue]);

  const yTickValues = useMemo(() => {
    const tickStep = niceCeiling(yMax / 4);
    const ticks: number[] = [];
    for (let tickValue = tickStep; tickValue <= yMax * 1.001; tickValue += tickStep) ticks.push(tickValue);
    return ticks;
  }, [yMax]);
  const xTickTimes = [0.25, 0.5, 0.75].map((fraction) => windowStartMs + (windowEndMs - windowStartMs) * fraction);

  const visibleOutages = outageEvents.filter(
    (outage) => outage.startMs + outage.durationMs > windowStartMs && outage.startMs < windowEndMs,
  );

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
    setHoverIndex(nearestIndex);
  };

  const hoveredBucket = hoverIndex !== null ? buckets[hoverIndex] : null;
  const tooltipOnLeft = hoveredBucket !== null && xForTime(hoveredBucket.timestampMs) > containerWidth * 0.62;

  return (
    <div className="chart-body" ref={containerRef}>
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
          className="chart-tooltip"
          style={{
            left: tooltipOnLeft ? undefined : xForTime(hoveredBucket.timestampMs) + 12,
            right: tooltipOnLeft ? containerWidth - xForTime(hoveredBucket.timestampMs) + 12 : undefined,
            top: PLOT_MARGIN.top + 4,
          }}
        >
          <div className="chart-tooltip-time">{formatClockTime(hoveredBucket.timestampMs)}</div>
          {series.map((chartSeries, seriesIndex) => (
            <div className="chart-tooltip-row" key={chartSeries.id}>
              <span className="series-key">
                <span className="series-swatch" style={{ background: `var(${chartSeries.colorVar})` }} />
                {chartSeries.label}
              </span>
              <span className="mono-value">
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
