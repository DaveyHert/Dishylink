// Persistent energy totals for the Power detail: day / week / month totals with
// honest coverage and a simple bar chart. A distinct feed from the live window
// energy above it — fetched from the collector, not the in-memory samples.

import { useState } from "react";
import { useEnergyHistory, type EnergyRange, type EnergyBucket } from "../hooks/useEnergyHistory";

const RANGE_TABS: { label: string; value: EnergyRange }[] = [
  { label: "1H", value: "1h" },
  { label: "6H", value: "6h" },
  { label: "12H", value: "12h" },
  { label: "Today", value: "today" },
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

function bucketLabel(bucket: EnergyBucket, range: EnergyRange): string {
  const date = new Date(bucket.t * 1000);
  if (range === "month") return date.toLocaleDateString([], { month: "short" }); // Jul
  if (range === "day" || range === "week") return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  // sub-day ranges (1H/6H/12H/Today): clock time
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Slot the collector only caught part of: its total is real but understates the period. */
function isPartial(bucket: EnergyBucket): boolean {
  return (
    bucket.kWh !== null && bucket.expectedSeconds > 0 && bucket.sampledSeconds / bucket.expectedSeconds < 0.9
  );
}

function bucketTitle(bucket: EnergyBucket, range: EnergyRange): string {
  const when = bucketLabel(bucket, range);
  if (bucket.kWh === null) return `${when} · no data — the collector wasn't running`;
  const total = `${when} · ${bucket.kWh.toFixed(3)} kWh`;
  if (!isPartial(bucket)) return total;
  const sampled = Math.round(bucket.sampledSeconds / 60);
  const expected = Math.round(bucket.expectedSeconds / 60);
  return `${total} — only ${sampled} of ${expected} min recorded`;
}

function EnergyBars({ buckets, range }: { buckets: EnergyBucket[]; range: EnergyRange }) {
  if (buckets.length === 0) return null;
  const maxKWh = Math.max(...buckets.map((bucket) => bucket.kWh ?? 0), 1e-9);
  // Show at most ~8 x-axis labels so dense ranges (a full day of hourly bars) don't crowd.
  // Slots with no data still hold their place, so every Nth slot is still every
  // Nth hour and the labels keep an even rhythm.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  return (
    <div className="energy-bars">
      {buckets.map((bucket, index) => (
        <div key={bucket.t} className="energy-bar-col" title={bucketTitle(bucket, range)}>
          {bucket.kWh === null ? (
            // An empty slot, not a zero one: a faint full-height wash marks the
            // hole without claiming no energy was used.
            <div className="energy-bar" style={{ height: "100%", background: "var(--ink-muted)", opacity: 0.06 }} />
          ) : (
            <div
              className="energy-bar"
              style={{
                height: `${(bucket.kWh / maxKWh) * 100}%`,
                // Part-sampled slots are real but short by construction; fade one
                // so a low bar is not read as a quiet hour.
                opacity: isPartial(bucket) ? 0.45 : undefined,
              }}
            />
          )}
          <span className="energy-bar-label">
            {index % labelEvery === 0 ? bucketLabel(bucket, range) : " "}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EnergyHistoryPanel({ active }: { active: boolean }) {
  const [range, setRange] = useState<EnergyRange>("today");
  const { data, loading, unavailable } = useEnergyHistory(range, active);

  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;

  return (
    <div className="energy-history">
      <div className="energy-history-header">
        <span className="energy-history-title">Total energy used</span>
        <div className="window-picker">
          {RANGE_TABS.map((tab) => (
            <button
              key={tab.value}
              className={range === tab.value ? "active" : ""}
              onClick={() => setRange(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {unavailable ? (
        <p className="energy-history-hint">
          Long-term energy needs the collector running. Start it with <code>npm run collector</code> and it
          will build up day / week / month history from now on.
        </p>
      ) : (
        <>
          <div className="energy-history-total">
            {data ? `${data.totalKWh.toFixed(data.totalKWh < 1 ? 3 : 2)} kWh` : loading ? "…" : "—"}
          </div>
          {data && (
            <div className="energy-history-coverage">
              collected {coveragePct}% of this period
              {coveragePct < 95 && " — total covers only the time the collector was running"}
            </div>
          )}
          {data && <EnergyBars buckets={data.buckets} range={range} />}
        </>
      )}
    </div>
  );
}
