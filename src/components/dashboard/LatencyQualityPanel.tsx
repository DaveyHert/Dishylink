// The Latency quality view: a 0–100 quality score, the percentiles and jitter
// gamers/VoIP care about (p95/p99, jitter, packet loss), and a bar chart of p95
// across the selected window (day/week/month, plus the shorter spans the live
// buffer also covers). Reads the persisted per-minute histogram the historian
// folds — not the 6h raw-sample window — so day and week are actually answerable.
//
// A view, not a container: the parent composes it into a DetailsModal, same as
// the other panels. Owns its own time window (local state).

import { useState } from "react";
import { useLatencyHistory, type LatencySummary } from "../../hooks/useLatencyHistory";
import { RANGE_TABS, bucketLabel } from "../shared/rangeTabs";
import { RangeBars, type RangeBarColumn } from "../shared/RangeBarChart";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";
import { FigureRow } from "../ui/figure-row";
import type { EnergyRange } from "../../hooks/useEnergyHistory";

function gradeColor(grade: string): string {
  if (grade === "A" || grade === "B") return "text-emerald-500";
  if (grade === "C") return "text-amber-500";
  return "text-red-500";
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)} ms`;
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
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
  if (bucket.p95 === null) return `${when} · no data — the recorder wasn't running`;
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
  const [range, setRange] = useState<EnergyRange>("today");
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
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <div className='flex items-baseline gap-2'>
            <span className='text-[40px] font-bold leading-none'>
              {data ? data.score : loading ? "…" : "—"}
            </span>
            {data && (
              <span className={`text-[28px] font-bold leading-none ${gradeColor(data.grade)}`}>
                {data.grade}
              </span>
            )}
          </div>
          <div className='mt-1 text-[12px] font-medium text-muted-foreground'>
            latency quality score
          </div>
        </div>
        <SegmentedControl
          options={RANGE_TABS}
          value={range}
          onChange={setRange}
          label='Latency range'
        />
      </div>

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
              { label: "p95", value: formatMs(dish?.p95 ?? null), unit: "" },
              { label: "p99", value: formatMs(dish?.p99 ?? null), unit: "" },
              { label: "Jitter", value: formatMs(dish?.jitter ?? null), unit: "" },
              { label: "Packet loss", value: formatPct(dish?.dropPct ?? null), unit: "" },
              ...(dish?.spread !== null && dish?.spread !== undefined
                ? [{ label: "p99 − p50", value: formatMs(dish.spread), unit: "" }]
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
    </div>
  );
}
