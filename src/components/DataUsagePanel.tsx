// Data usage sheet: self-measured download/upload volume from the collector,
// in the layout of the Starlink account page's usage chart — headline GB,
// range tabs, stacked down/up bars. Clearly labeled as measured by Dishboard
// (Starlink's own billing meter is cloud-side and not exposed locally).

import { useState } from "react";
import { useDataUsage, type UsageBucket } from "../hooks/useDataUsage";
import type { EnergyRange } from "../hooks/useEnergyHistory";

const RANGE_TABS: { label: string; value: EnergyRange }[] = [
  { label: "1H", value: "1h" },
  { label: "6H", value: "6h" },
  { label: "12H", value: "12h" },
  { label: "Today", value: "today" },
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

function formatGB(gigabytes: number): string {
  if (gigabytes >= 100) return gigabytes.toFixed(0);
  if (gigabytes >= 1) return gigabytes.toFixed(1);
  return gigabytes.toFixed(2);
}

function bucketLabel(bucket: UsageBucket, range: EnergyRange): string {
  const date = new Date(bucket.t * 1000);
  if (range === "month") return date.toLocaleDateString([], { month: "short" });
  if (range === "day" || range === "week") return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function UsageBars({ buckets, range }: { buckets: UsageBucket[]; range: EnergyRange }) {
  if (buckets.length === 0) return null;
  const totalOf = (bucket: UsageBucket) => (bucket.downGB ?? 0) + (bucket.upGB ?? 0);
  const maxTotalGB = Math.max(...buckets.map(totalOf), 1e-9);
  // Slots with no data hold their place, so every Nth slot is still every Nth
  // hour and the labels keep an even rhythm.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  return (
    <div className="energy-bars">
      {buckets.map((bucket, index) => {
        const missing = bucket.downGB === null || bucket.upGB === null;
        const total = totalOf(bucket);
        return (
          <div
            key={bucket.t}
            className="energy-bar-col"
            title={
              missing
                ? `${bucketLabel(bucket, range)} · no data — the collector wasn't running`
                : `${bucketLabel(bucket, range)} · ↓${formatGB(bucket.downGB!)} GB · ↑${formatGB(bucket.upGB!)} GB`
            }
          >
            {missing ? (
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
            )}
            <span className="energy-bar-label">{index % labelEvery === 0 ? bucketLabel(bucket, range) : " "}</span>
          </div>
        );
      })}
    </div>
  );
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
