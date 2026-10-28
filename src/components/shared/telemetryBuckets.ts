import type { TelemetrySample } from "@core/telemetry";

export interface BucketPoint {
  timestampMs: number;
  values: (number | null)[];
  hasGapBefore: boolean;
}

interface BucketSeries {
  getValue: (sample: TelemetrySample) => number | null;
  bucketReduce?: "avg" | "max" | "min";
}

export function telemetryBuckets(
  samples: TelemetrySample[],
  series: BucketSeries[],
  windowStartMs: number,
  windowEndMs: number,
  plotWidth: number,
  minGapMs: number,
) {
  const bucketCount = Math.max(Math.floor(plotWidth / 2), 30);
  const bucketSpanMs = Math.ceil((windowEndMs - windowStartMs) / bucketCount);
  const grouped = new Map<number, TelemetrySample[]>();
  for (const sample of samples) {
    // Half-open window also keeps a frozen endpoint immune to later samples.
    if (sample.timestampMs < windowStartMs || sample.timestampMs >= windowEndMs) continue;
    const key = Math.floor(sample.timestampMs / bucketSpanMs);
    const group = grouped.get(key);
    if (group) group.push(sample);
    else grouped.set(key, [sample]);
  }

  const keys = [...grouped.keys()].sort((left, right) => left - right);
  const gapThresholdMs = Math.max(bucketSpanMs * 1.5, minGapMs);
  const buckets: BucketPoint[] = keys.map((key, index) => {
    const bucketSamples = grouped.get(key)!;
    // Use the midpoint of the visible part at either edge. Interior midpoints
    // stay epoch-aligned; edge points never escape the half-open window.
    const startMs = Math.max(key * bucketSpanMs, windowStartMs);
    const endMs = Math.min((key + 1) * bucketSpanMs, windowEndMs);
    return {
      timestampMs: startMs + (endMs - startMs) / 2,
      values: series.map((chartSeries) => {
        const values = bucketSamples
          .map(chartSeries.getValue)
          .filter((value): value is number => value !== null && Number.isFinite(value));
        if (values.length === 0) return null;
        if (chartSeries.bucketReduce === "max") return Math.max(...values);
        if (chartSeries.bucketReduce === "min") return Math.min(...values);
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      }),
      // Gap classification uses epoch spacing, not clipped edge midpoints.
      hasGapBefore: index > 0 && (key - keys[index - 1]) * bucketSpanMs > gapThresholdMs,
    };
  });

  const gapRegions: { startMs: number; endMs: number }[] = [];
  if (buckets.length === 0) {
    gapRegions.push({ startMs: windowStartMs, endMs: windowEndMs });
  } else {
    if (buckets[0].timestampMs - windowStartMs > gapThresholdMs) {
      gapRegions.push({ startMs: windowStartMs, endMs: buckets[0].timestampMs });
    }
    for (let index = 1; index < buckets.length; index++) {
      if (buckets[index].hasGapBefore) {
        gapRegions.push({
          startMs: buckets[index - 1].timestampMs,
          endMs: buckets[index].timestampMs,
        });
      }
    }
    const newestMs = buckets[buckets.length - 1].timestampMs;
    if (windowEndMs - newestMs > gapThresholdMs) {
      gapRegions.push({ startMs: newestMs, endMs: windowEndMs });
    }
  }
  return { buckets, bucketSpanMs, gapRegions };
}
