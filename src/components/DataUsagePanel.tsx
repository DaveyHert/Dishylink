// Data usage sheet: self-measured download/upload volume from the collector,
// in the layout of the Starlink account page's usage chart — headline GB,
// range tabs, stacked down/up bars. Clearly labeled as measured by Dishboard
// (Starlink's own billing meter is cloud-side and not exposed locally).

import { useState } from "react";
import { useDataUsage, type UsageBucket } from "../hooks/useDataUsage";
import type { EnergyRange } from "../hooks/useEnergyHistory";
import { RANGE_TABS, RangeBars, bucketLabel, type RangeBarColumn } from "./RangeBarChart";

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
        <div className="usage-bar-stack" style={{ height: `${(total / maxTotalGB) * 100}%` }}>
          <div
            className="usage-bar-up"
            style={{ height: `${((bucket.upGB ?? 0) / Math.max(total, 1e-9)) * 100}%` }}
          />
          <div className="usage-bar-down" style={{ flex: 1 }} />
        </div>
      ),
    };
  });
  return <RangeBars columns={columns} range={range} />;
}

export function DataUsagePanel() {
  const [range, setRange] = useState<EnergyRange>("today");
  const { data, unavailable } = useDataUsage(range, true);
  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;

  if (unavailable) {
    return (
      <p className="energy-history-hint">
        Data usage needs the collector running. Start it with <code>npm run collector</code> and Dishboard
        will meter traffic from now on.
      </p>
    );
  }

  return (
    <div>
      <div className="detail-figures">
        <div className="detail-figure">
          <div className="detail-figure-value">
            {data ? formatGB(data.totalDownGB) : "—"}
            <span className="detail-figure-unit">GB</span>
          </div>
          <div className="detail-figure-label">↓ Download</div>
        </div>
        <div className="detail-figure-divider" />
        <div className="detail-figure">
          <div className="detail-figure-value">
            {data ? formatGB(data.totalUpGB) : "—"}
            <span className="detail-figure-unit">GB</span>
          </div>
          <div className="detail-figure-label">↑ Upload</div>
        </div>
        <div className="detail-figure-divider" />
        <div className="detail-figure">
          <div className="detail-figure-value">
            {data ? formatGB(data.totalDownGB + data.totalUpGB) : "—"}
            <span className="detail-figure-unit">GB</span>
          </div>
          <div className="detail-figure-label">Total</div>
        </div>
      </div>

      <div className="window-picker detail-window-picker">
        {RANGE_TABS.map((tab) => (
          <button key={tab.value} className={range === tab.value ? "active" : ""} onClick={() => setRange(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {data && <UsageBars buckets={data.buckets} range={range} />}
      {data && (
        <div className="energy-history-coverage">
          collected {coveragePct}% of this period
          {coveragePct < 95 && " — totals cover only the time the collector was running"}
        </div>
      )}

      <div className="detail-explainer">
        <div className="detail-explainer-title">How is this measured?</div>
        <p>
          Dishboard integrates the dish's own per-second throughput telemetry into per-minute volume, on
          this machine. It tracks your real traffic from the moment the collector started — it is not
          Starlink's billing meter, which lives in their cloud and counts in UTC.
        </p>
      </div>
    </div>
  );
}
