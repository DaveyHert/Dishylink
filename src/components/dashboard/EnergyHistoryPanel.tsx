// Persistent energy totals for the Power detail: day / week / month totals with
// honest coverage and a simple bar chart. A distinct feed from the live window
// energy above it — fetched from the historian, not the in-memory samples.

import { useState } from "react";
import {
  useEnergyHistory,
  type EnergyRange,
  type EnergyBucket,
} from "../../hooks/useEnergyHistory";
import { RangeBars, type RangeBarColumn } from "../shared/RangeBarChart";
import { RANGE_TABS, bucketLabel } from "../shared/rangeTabs";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";

/** Slot the historian only caught part of: its total is real but understates the period. */
function isPartial(bucket: EnergyBucket): boolean {
  return (
    bucket.kWh !== null &&
    bucket.expectedSeconds > 0 &&
    bucket.sampledSeconds / bucket.expectedSeconds < 0.9
  );
}

function bucketTitle(bucket: EnergyBucket, range: EnergyRange): string {
  const when = bucketLabel(bucket.t, range);
  if (bucket.kWh === null) return `${when} · no data — the historian wasn't running`;
  const total = `${when} · ${bucket.kWh.toFixed(3)} kWh`;
  if (!isPartial(bucket)) return total;
  const sampled = Math.round(bucket.sampledSeconds / 60);
  const expected = Math.round(bucket.expectedSeconds / 60);
  return `${total} — only ${sampled} of ${expected} min recorded`;
}

function EnergyBars({ buckets, range }: { buckets: EnergyBucket[]; range: EnergyRange }) {
  const maxKWh = Math.max(...buckets.map((bucket) => bucket.kWh ?? 0), 1e-9);
  const columns: RangeBarColumn[] = buckets.map((bucket) => ({
    key: bucket.t,
    label: bucketLabel(bucket.t, range),
    title: bucketTitle(bucket, range),
    bar:
      bucket.kWh === null ? (
        // An empty slot, not a zero one: a faint full-height wash marks the
        // hole without claiming no energy was used.
        <div
          className='w-full min-h-[2px] rounded-t-[3px]'
          style={{ height: "100%", background: "var(--ink-muted)", opacity: 0.06 }}
        />
      ) : (
        <div
          className='w-full min-h-[2px] rounded-t-[3px] bg-chart-warm'
          style={{
            height: `${(bucket.kWh / maxKWh) * 100}%`,
            // Part-sampled slots are real but short by construction; fade one
            // so a low bar is not read as a quiet hour.
            opacity: isPartial(bucket) ? 0.45 : undefined,
          }}
        />
      ),
  }));
  return <RangeBars columns={columns} range={range} />;
}

export function EnergyHistoryPanel({ active }: { active: boolean }) {
  const [range, setRange] = useState<EnergyRange>("today");
  const { data, loading, unavailable } = useEnergyHistory(range, active);

  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;

  return (
    <div className='mt-4 border-t border-hairline pt-[13px]'>
      <div className='flex flex-wrap items-center justify-between gap-2.5'>
        <span className='text-[14.5px] font-[650]'>Total energy used</span>
        <SegmentedControl
          options={RANGE_TABS}
          value={range}
          onChange={setRange}
          label='Energy range'
        />
      </div>

      {unavailable ? (
        <Callout className='mt-2.5'>
          Long-term energy needs the history recorder running. Start it with{" "}
          <code>npm run historian</code>
          and it will build up day / week / month history from now on.
        </Callout>
      ) : (
        <>
          <div className='mt-2.5 text-[27px] font-bold'>
            {data ? `${data.totalKWh.toFixed(data.totalKWh < 1 ? 3 : 2)} kWh` : loading ? "…" : "—"}
          </div>
          {data && (
            <div className='mt-1 text-[12px] font-medium text-muted-foreground'>
              collected {coveragePct}% of this period
              {coveragePct < 95 && " — total covers only the time the recorder was running"}
            </div>
          )}
          {data && <EnergyBars buckets={data.buckets} range={range} />}
        </>
      )}
    </div>
  );
}
