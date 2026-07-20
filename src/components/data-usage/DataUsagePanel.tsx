// Data usage sheet: self-measured download/upload volume from the collector,
// in the layout of the Starlink account page's usage chart — headline GB,
// range tabs, stacked down/up bars. Clearly labeled as measured by DishyLink
// (Starlink's own billing meter is cloud-side and not exposed locally).

import { useState } from "react";
import { useDataUsage, type UsageBucket } from "../../hooks/useDataUsage";
import type { EnergyRange } from "../../hooks/useEnergyHistory";
import { RANGE_TABS, RangeBars, bucketLabel, type RangeBarColumn } from "../shared/RangeBarChart";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";
import { Explainer } from "../ui/explainer";
import { FigureRow } from "../ui/figure-row";
import { DeviceUsageList } from "./DeviceUsageList";
import { CloudDataUsage } from "./CloudDataUsage";

type UsageSource = "local" | "cloud";

const SOURCE_TABS = [
  { label: "Local Session", value: "local" as const },
  { label: "Starlink billing", value: "cloud" as const },
];

function formatGB(gigabytes: number): string {
  if (gigabytes >= 100) return gigabytes.toFixed(0);
  if (gigabytes >= 1) return gigabytes.toFixed(1);
  return gigabytes.toFixed(2);
}

function UsageBars({ buckets, range }: { buckets: UsageBucket[]; range: EnergyRange }) {
  const totalOf = (bucket: UsageBucket) => (bucket.downGB ?? 0) + (bucket.upGB ?? 0);
  const maxTotalGB = Math.max(...buckets.map(totalOf), 1e-9);
  const columns: RangeBarColumn[] = buckets.map((bucket) => {
    const missing = bucket.downGB === null || bucket.upGB === null;
    const total = totalOf(bucket);
    const when = bucketLabel(bucket.t, range);
    return {
      key: bucket.t,
      label: when,
      title: missing
        ? `${when} · no data — the collector wasn't running`
        : `${when} · ↓${formatGB(bucket.downGB!)} GB · ↑${formatGB(bucket.upGB!)} GB`,
      bar: missing ? (
        // An empty slot, not a zero one: mark the hole rather than draw a
        // bar claiming no traffic passed.
        <div style={{ height: "100%", width: "100%", background: "var(--ink-muted)", opacity: 0.06 }} />
      ) : (
        <div
          className="flex min-h-0.5 w-full flex-col overflow-hidden rounded-t-[3px]"
          style={{ height: `${(total / maxTotalGB) * 100}%` }}
        >
          <div
            className="min-h-0 bg-[var(--chart-warm)]"
            style={{ height: `${((bucket.upGB ?? 0) / Math.max(total, 1e-9)) * 100}%` }}
          />
          <div className="bg-[var(--chart-ink)] opacity-75" style={{ flex: 1 }} />
        </div>
      ),
    };
  });
  return (
    <RangeBars
      columns={columns}
      range={range}
      heightPx={150}
      yAxis={{ max: maxTotalGB, format: (v) => `${formatGB(v)} GB` }}
    />
  );
}

export function DataUsagePanel() {
  const [source, setSource] = useState<UsageSource>("local");

  return (
    <div>
      <SegmentedControl
        options={SOURCE_TABS}
        value={source}
        onChange={setSource}
        label="Data usage source"
        variant="glider"
        className="mb-1"
      />
      {source === "local" ? <LocalDataUsage /> : <CloudDataUsage active={source === "cloud"} />}
    </div>
  );
}

function LocalDataUsage() {
  const [range, setRange] = useState<EnergyRange>("today");
  const { data, unavailable } = useDataUsage(range, true);
  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;

  if (unavailable) {
    return (
      <Callout className="mt-2.5">
        Data usage needs the history recorder running. Start it with <code>npm run collector</code> and
        DishyLink will meter traffic from now on.
      </Callout>
    );
  }

  return (
    <div>
      <FigureRow
        figures={[
          { label: "↓ Download", value: data ? formatGB(data.totalDownGB) : "—", unit: "GB" },
          { label: "↑ Upload", value: data ? formatGB(data.totalUpGB) : "—", unit: "GB" },
          { label: "Total", value: data ? formatGB(data.totalDownGB + data.totalUpGB) : "—", unit: "GB" },
        ]}
      />
      <SegmentedControl
        options={RANGE_TABS}
        value={range}
        onChange={setRange}
        label="Data usage range"
        className="mb-2.5"
      />

      {data && <UsageBars buckets={data.buckets} range={range} />}
      {data && (
        <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">
          collected {coveragePct}% of this period
          {coveragePct < 95 && " — totals cover only the time the recorder was running"}
        </div>
      )}

      <Explainer title="How is this measured?">
        DishyLink integrates the dish's own per-second throughput telemetry into per-minute volume, on this
        machine. It tracks your real traffic from the moment the collector started — it is not Starlink's
        billing meter, which lives in their cloud and counts in UTC.
      </Explainer>

      <DeviceUsageList />
    </div>
  );
}
