// Per-minute energy + traffic buckets folded from per-second telemetry samples.
// Pure and IO-free, so every host shares one definition of a minute's total:
// the collector folds a poll's samples before appending them to disk, and the
// extension folds each cursor-gated drain before an additive upsert into
// IndexedDB. Both must agree on what a minute holds, or their histories diverge.

import type { TelemetrySample } from "./telemetry";

export interface MinuteBucket {
  minute: number;
  wattSeconds: number;
  samples: number;
  /** Downlink/uplink volume in bits (absent on rows written before data-usage tracking). */
  dlBits?: number;
  ulBits?: number;
}

/**
 * Sum a minute's running total with a freshly folded delta for the same minute.
 * A minute can fill across several drains — the extension wakes, drains only the
 * samples past its cursor, and adds them to whatever that minute already held.
 * Because the cursor guarantees each sample is drained once, adding is exact:
 * nothing is counted twice, and a minute split over two wakes still totals right.
 */
export function addMinuteBucket(base: MinuteBucket | undefined, delta: MinuteBucket): MinuteBucket {
  if (!base) return { ...delta };
  return {
    minute: delta.minute,
    wattSeconds: base.wattSeconds + delta.wattSeconds,
    samples: base.samples + delta.samples,
    dlBits: (base.dlBits ?? 0) + (delta.dlBits ?? 0),
    ulBits: (base.ulBits ?? 0) + (delta.ulBits ?? 0),
  };
}

/** Group per-second samples into per-minute energy+traffic buckets. Each sample ≈ 1s. */
export function foldSamplesToMinutes(samples: TelemetrySample[]): Map<number, MinuteBucket> {
  const buckets = new Map<number, MinuteBucket>();
  for (const sample of samples) {
    const minute = Math.floor(sample.timestampMs / 60_000) * 60;
    const bucket = buckets.get(minute) ?? {
      minute,
      wattSeconds: 0,
      samples: 0,
      dlBits: 0,
      ulBits: 0,
    };
    bucket.wattSeconds += sample.powerW ?? 0;
    // per-second sample: bps over one second ≈ bits transferred
    bucket.dlBits = (bucket.dlBits ?? 0) + (sample.downlinkBps ?? 0);
    bucket.ulBits = (bucket.ulBits ?? 0) + (sample.uplinkBps ?? 0);
    bucket.samples += 1;
    buckets.set(minute, bucket);
  }
  return buckets;
}
