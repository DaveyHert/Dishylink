// The Latency quality view: a 0–100 quality score, the percentiles and jitter
// gamers/VoIP care about (p95/p99, jitter, packet loss), and a bar chart of p95
// across the selected window (day/week/month, plus the shorter spans the live
// buffer also covers). Reads the persisted per-minute histogram the historian
// folds — not the 6h raw-sample window — so day and week are actually answerable.
//
// A view, not a container: LatencyDetailPanel mounts it behind its Quality tab.
// Owns its own time window (local state).

import { useState } from "react";
import { gradeColorVar } from "@core/latencySummary";
import { useLatencyHistory, type LatencySummary } from "../../hooks/useLatencyHistory";
import { RANGE_TABS, bucketLabel } from "../shared/rangeTabs";
import { RangeBars, type RangeBarColumn } from "../shared/RangeBarChart";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";
import { Explainer } from "../ui/explainer";
import { FigureRow, type Figure } from "../ui/figure-row";
import type { EnergyRange } from "../../hooks/useEnergyHistory";

function figure(label: string, value: number | null | undefined, unit: string): Figure {
  if (value === null || value === undefined) return { label, value: "—", unit: "" };
  return { label, value: value.toFixed(unit === "%" ? 1 : 0), unit };
}

function isPartial(bucket: LatencySummary["buckets"][number]): boolean {
  return (
    bucket.p95 !== null &&
    bucket.expectedSeconds > 0 &&
    bucket.sampledSeconds / bucket.expectedSeconds < 0.9
  );
}

function bucketTitle(bucket: LatencySummary["buckets"][number], range: EnergyRange): string {
  const when = bucketLabel(bucket.t, range);
  // No p95 means no latency reading landed. That is a dish outage if the recorder
  // was up (seconds recorded), and a gap in recording if it was not.
  if (bucket.p95 === null) {
    return bucket.sampledSeconds > 0
      ? `${when} · service was down`
      : `${when} · no data — the recorder wasn't running`;
  }
  const parts = [
    `p95 ${bucket.p95.toFixed(0)} ms`,
    bucket.p99 !== null ? `p99 ${bucket.p99.toFixed(0)} ms` : null,
    bucket.jitter !== null ? `jitter ${bucket.jitter.toFixed(0)} ms` : null,
    bucket.dropPct !== null ? `loss ${bucket.dropPct.toFixed(1)}%` : null,
  ].filter(Boolean) as string[];
  const total = parts.join(" · ");
  if (!isPartial(bucket)) return `${when} · ${total}`;
  const sampled = Math.round(bucket.sampledSeconds / 60);
  const expected = Math.round(bucket.expectedSeconds / 60);
  return `${when} · ${total} — only ${sampled} of ${expected} min recorded`;
}

export function LatencyQualityPanel() {
  const [range, setRange] = useState<EnergyRange>("1h");
  const { data, loading, unavailable } = useLatencyHistory(range, true);

  const maxP95 = data ? Math.max(...data.buckets.map((bucket) => bucket.p95 ?? 0), 50) : 50;

  const columns: RangeBarColumn[] = data
    ? data.buckets.map((bucket) => ({
        key: bucket.t,
        label: bucketLabel(bucket.t, range),
        title: bucketTitle(bucket, range),
        bar:
          bucket.p95 === null ? (
            <div
              className='w-full min-h-0.5 rounded-t-[3px]'
              style={{ height: "100%", background: "var(--ink-muted)", opacity: 0.06 }}
            />
          ) : (
            <div
              className='w-full min-h-0.5 rounded-t-[3px] bg-chart-ink'
              style={{
                height: `${Math.max((bucket.p95 / maxP95) * 100, 2)}%`,
                opacity: isPartial(bucket) ? 0.45 : undefined,
              }}
            />
          ),
      }))
    : [];

  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;
  const dish = data?.dish;

  return (
    <div>
      <div>
        <span className='text-[40px] font-bold leading-none'>
          {data ? data.score : loading ? "…" : "—"}
        </span>
        {data && (
          <span
            className='align-sub text-[20px] font-bold'
            style={{ color: `var(${gradeColorVar(data.grade)})` }}
          >
            {data.grade}
          </span>
        )}
      </div>
      <div className='mt-1 text-[12px] font-medium text-muted-foreground'>
        Latency quality score
      </div>

      <SegmentedControl
        options={RANGE_TABS}
        value={range}
        onChange={setRange}
        label='Latency range'
        className='mt-3'
      />

      {unavailable ? (
        <Callout className='mt-3'>
          Long-term latency needs the history recorder running. Start it with{" "}
          <code>npm run historian</code> and it will build up day / week history from now on.
        </Callout>
      ) : (
        <>
          <FigureRow
            className='mt-4'
            figures={[
              figure("p95", dish?.p95, "ms"),
              figure("p99", dish?.p99, "ms"),
              figure("Jitter", dish?.jitter, "ms"),
              figure("Packet loss", dish?.dropPct, "%"),
              ...(dish?.spread !== null && dish?.spread !== undefined
                ? [figure("p99 − p50", dish.spread, "ms")]
                : []),
            ]}
          />

          {data && (
            <div className='mt-1 text-[12px] font-medium text-muted-foreground'>
              collected {coveragePct}% of this period
              {coveragePct < 95 && " — figures cover only the time the recorder was running"}
            </div>
          )}

          <div className='mt-4'>
            <h3 className='text-[14.5px] font-[650]'>p95 latency</h3>
            <RangeBars
              columns={columns}
              range={range}
              heightPx={120}
              yAxis={{ max: maxP95, format: (v) => `${Math.round(v)} ms` }}
            />
          </div>
        </>
      )}

      <Explainer title='What is latency quality?'>
        Latency quality summarizes the period as a single 0–100 score with a letter grade, weighing
        typical latency, jitter, worst-case spikes, and packet loss together rather than just the
        average. A connection that's mostly fast but occasionally stutters scores lower than one
        that's a little slower but steady, since that unevenness is what you'd actually notice in a
        game, a call, or a video stream.
      </Explainer>
    </div>
  );
}
