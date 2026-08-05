// Reusable time-series chart: hairline grid, 2px round lines, 10% area wash,
// outage bands, crosshair + tooltip. Samples are bucketed per pixel.

import { useMemo, useRef, useState, useEffect, useCallback, useId } from "react";
import { outageEventKind, type TelemetrySample, type OutageEvent } from "@core/telemetry";
import { formatClockTime } from "../../lib/format";
import {
  Crosshair,
  NoDataBands,
  OutageBands,
  PlotBaseline,
  PlotGrid,
  PlotTimeAxis,
  SeriesArea,
  SeriesLine,
  WashGradient,
  type PlotFrame,
} from "./chartMarks";
import { useNow } from "../../hooks/useNow";

export interface ChartSeries {
  id: string;
  label: string;
  colorVar: string;
  getValue: (sample: TelemetrySample) => number | null;
  bucketReduce?: "avg" | "max" | "min";
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
  /** Hard ceiling for the y-axis. Set it for series with a real upper bound —
   *  a percentage tops out at 100, and the usual headroom above the highest
   *  sample would otherwise label the axis 120%. */
  maxValue?: number;
  /** Multiplier of clearance above the tallest sample before the axis rounds
   *  up. The default hugs the data; raise it for jittery series (per-device
   *  throughput) where a full frame reads as alarming rather than busy. */
  headroom?: number;
  /** Freezes the window's newest edge on a fixed instant instead of the live
   *  clock. A series whose figure is quantized to a boundary (power, to a 5s
   *  bucket) passes that boundary here so the whole plot — points, axis labels,
   *  right edge — steps with the figure rather than sliding every second. Left
   *  unset, the window ends on the ticking clock as before. */
  windowEndMs?: number;
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
 * a minute is real absence — the historian's machine asleep, a restart, the dish
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
  maxValue,
  headroom = 1.08,
  windowEndMs: windowEndOverrideMs,
}: TelemetryChartProps) {
  const [containerRef, containerWidth] = useElementWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const washGradientId = useId();

  const plotWidth = Math.max(containerWidth - PLOT_MARGIN.left - PLOT_MARGIN.right, 50);
  const plotHeight = height - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  // The window ends now, not at the newest sample held. "15M" is a claim about
  // the clock: the last fifteen minutes, whether or not anything was recorded in
  // them. A dish that has been silent for ten of those minutes draws two minutes
  // of line and ten of empty right edge, which is the true picture. Anchoring to
  // the newest sample instead would keep the chart looking full by quietly
  // showing an older fifteen minutes under a live label.
  // The clock still ticks the chart on every render (an outage must keep growing
  // its unmeasured right edge even while nothing arrives); an override only pins
  // where the window ends. Called unconditionally — a hook cannot be skipped.
  const tickingNowMs = useNow();
  const windowEndMs = windowEndOverrideMs ?? tickingNowMs;
  const windowStartMs = windowEndMs - windowMinutes * 60_000;

  const { buckets, bucketSpanMs } = useMemo<{
    buckets: BucketPoint[];
    bucketSpanMs: number;
  }>(() => {
    // Half-open [start, end): with a frozen end, samples past the boundary would
    // otherwise clamp into the last bucket and creep its mean every second,
    // defeating the freeze. On the live clock nothing is newer than now, so this
    // excludes only a sample landing exactly on it — no effect on those charts.
    const visibleSamples = samples.filter(
      (sample) => sample.timestampMs >= windowStartMs && sample.timestampMs < windowEndMs,
    );
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
            if (chartSeries.bucketReduce === "max") return Math.max(...seriesValues);
            if (chartSeries.bucketReduce === "min") return Math.min(...seriesValues);
            return seriesValues.reduce((sum, value) => sum + value, 0) / seriesValues.length;
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
  }, [samples, series, windowStartMs, windowEndMs, plotWidth, minGapMs]);

  // Ceiling and gridlines come out of ONE derivation: the ceiling is a whole
  // number of tick steps, so the top gridline is always the ceiling. Choosing
  // them independently (a "nice" ceiling, then a "nice" step) let them disagree
  // — a 130 ms spike got a 150 ceiling with gridlines every 40, and drew in the
  // unlabeled band above the 120 line as if it had escaped the chart.
  const { yMax, yTickValues } = useMemo(() => {
    let observedMax = 0;
    for (const bucket of buckets) {
      for (const value of bucket.values) {
        if (value !== null && value > observedMax) observedMax = value;
      }
    }
    const rawCeiling = maxValue ?? observedMax * headroom;
    const tickStep = niceCeiling(rawCeiling / 4);
    const ceiling = maxValue ?? Math.max(Math.ceil(rawCeiling / tickStep), 1) * tickStep;
    const ticks: number[] = [];
    for (let tickValue = tickStep; tickValue <= ceiling * 1.001; tickValue += tickStep)
      ticks.push(tickValue);
    return { yMax: ceiling, yTickValues: ticks };
  }, [buckets, maxValue, headroom]);

  const xForTime = useCallback(
    (timestampMs: number) =>
      PLOT_MARGIN.left +
      ((timestampMs - windowStartMs) / (windowEndMs - windowStartMs)) * plotWidth,
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
        const lineSegment = run
          .map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join("");
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
    // Nothing at all in the window — a dish that has been silent longer than the
    // window is wide. The whole span is unmeasured, and saying so is the entire
    // content of the chart at that point.
    if (buckets.length === 0) return [{ startMs: windowStartMs, endMs: windowEndMs }];
    const gapThresholdMs = Math.max(bucketSpanMs * 1.5, minGapMs);
    const regions: { startMs: number; endMs: number }[] = [];
    if (buckets[0].timestampMs - windowStartMs > gapThresholdMs) {
      regions.push({ startMs: windowStartMs, endMs: buckets[0].timestampMs });
    }
    for (let index = 1; index < buckets.length; index++) {
      if (buckets[index].hasGapBefore) {
        regions.push({
          startMs: buckets[index - 1].timestampMs,
          endMs: buckets[index].timestampMs,
        });
      }
    }
    // A hole at the right edge: readings stopped partway through the window and
    // have not resumed — the outage that is still going on. It gets the same
    // treatment as one in the middle, since it is the same fact about the same
    // window.
    const newestMs = buckets[buckets.length - 1].timestampMs;
    if (windowEndMs - newestMs > gapThresholdMs) {
      regions.push({ startMs: newestMs, endMs: windowEndMs });
    }
    return regions;
  }, [buckets, bucketSpanMs, windowStartMs, windowEndMs, minGapMs]);

  const xTickTimes = [0.25, 0.5, 0.75].map(
    (fraction) => windowStartMs + (windowEndMs - windowStartMs) * fraction,
  );

  // Only real outages shade the chart, and the event's kind is what says so —
  // not its severity (the dish files "outage booting" as advisory) and not its
  // duration (the router's keepalive-ping drops run for half a minute or more).
  // Banding those was telling the reader service was down across a stretch where
  // the throughput line directly above showed traffic flowing the whole time.
  // Duration still has to be positive: the band renderer floors every band at
  // 2px, so a zero-length outage would paint a red hairline over nothing.
  const visibleOutages = outageEvents.filter(
    (outage) =>
      outageEventKind(outage.cause) === "outage" &&
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

  const plotFrame: PlotFrame = {
    left: PLOT_MARGIN.left,
    top: PLOT_MARGIN.top,
    width: plotWidth,
    height: plotHeight,
  };
  const hoveredBucket = hoverIndex !== null ? buckets[hoverIndex] : null;
  const tooltipOnLeft =
    hoveredBucket !== null && xForTime(hoveredBucket.timestampMs) > containerWidth * 0.62;

  return (
    <div className='relative' ref={containerRef}>
      <svg
        width={containerWidth}
        height={height}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* Starlink-style wash: series color fading to transparent below the line */}
        <defs>
          <WashGradient id={washGradientId} colorVar={series[0].colorVar} />
        </defs>
        <PlotGrid
          frame={plotFrame}
          ticks={yTickValues.map((tickValue) => ({
            label: formatTick(tickValue),
            y: yForValue(tickValue),
          }))}
        />
        <PlotBaseline frame={plotFrame} />
        <PlotTimeAxis
          y={height - 6}
          ticks={xTickTimes.map((tickTime) => ({
            label: formatClockTime(tickTime).slice(0, 5),
            x: xForTime(tickTime),
          }))}
        />
        <OutageBands
          frame={plotFrame}
          bands={visibleOutages.map((outage, outageIndex) => {
            const bandStartX = Math.max(xForTime(outage.startMs), leftEdgeX);
            const bandEndX = Math.min(
              xForTime(outage.startMs + outage.durationMs),
              leftEdgeX + plotWidth,
            );
            return { key: outageIndex, x: bandStartX, width: Math.max(bandEndX - bandStartX, 2) };
          })}
        />
        <NoDataBands
          frame={plotFrame}
          bands={gapRegions.flatMap((region) => {
            const bandStartX = Math.max(xForTime(region.startMs), leftEdgeX);
            const bandEndX = Math.min(xForTime(region.endMs), leftEdgeX + plotWidth);
            const bandWidth = bandEndX - bandStartX;
            return bandWidth <= 0 ? [] : [{ key: region.startMs, x: bandStartX, width: bandWidth }];
          })}
        />
        {areaPath && <SeriesArea d={areaPath} gradientId={washGradientId} />}
        {seriesPaths.map((linePath, seriesIndex) => (
          <SeriesLine
            key={series[seriesIndex].id}
            d={linePath}
            colorVar={series[seriesIndex].colorVar}
          />
        ))}
        {hoveredBucket && (
          <Crosshair
            frame={plotFrame}
            x={xForTime(hoveredBucket.timestampMs)}
            points={hoveredBucket.values.flatMap((value, seriesIndex) =>
              value === null
                ? []
                : [
                    {
                      key: series[seriesIndex].id,
                      y: yForValue(value),
                      colorVar: series[seriesIndex].colorVar,
                    },
                  ],
            )}
          />
        )}
      </svg>

      {hoveredBucket && (
        <div
          className='pointer-events-none absolute z-10 min-w-[138px] rounded-md bg-popover px-[11px] py-[9px] font-mono text-[11px] shadow-[0_8px_28px_rgba(0,0,0,0.35)]'
          style={{
            left: tooltipOnLeft ? undefined : xForTime(hoveredBucket.timestampMs) + 12,
            right: tooltipOnLeft
              ? containerWidth - xForTime(hoveredBucket.timestampMs) + 12
              : undefined,
            top: PLOT_MARGIN.top + 4,
          }}
        >
          <div className='mb-[5px] text-[10px] tracking-[0.05em] text-muted-foreground'>
            {formatClockTime(hoveredBucket.timestampMs)}
          </div>
          {series.map((chartSeries, seriesIndex) => (
            <div
              className='flex items-center justify-between gap-[7px] leading-[1.7]'
              key={chartSeries.id}
            >
              <span className='inline-flex items-center gap-1.5 text-ink-secondary'>
                <span
                  className='size-[9px] flex-none rounded-full'
                  style={{ background: `var(${chartSeries.colorVar})` }}
                />
                {chartSeries.label}
              </span>
              <span className='font-mono tabular-nums'>
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
