// The bar chart shared by the Power (energy) and Data usage sheets: range tabs,
// a plot row, and a label row. Both sheets draw the same frame and differ only
// in what fills a column, so the frame lives here and the bar comes in as a node.
//
// Layout note: the plot and label rows are declared once on the chart and each
// column adopts them via `subgrid`. A column therefore cannot size its own bar
// box — which is what previously let a column with no label hand the reclaimed
// height to its bar, staggering baselines and scaling those bars against a
// taller box than their neighbours.

import type { ReactNode } from "react";
import { useElementWidth, labelStride } from "../../hooks/useElementWidth";
import type { EnergyRange } from "../../hooks/useEnergyHistory";

export const RANGE_TABS: { label: string; value: EnergyRange }[] = [
  { label: "1H", value: "1h" },
  { label: "6H", value: "6h" },
  { label: "12H", value: "12h" },
  { label: "Today", value: "today" },
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

/** Clock time for sub-day ranges, date for day/week, month name for month. */
export function bucketLabel(epochSeconds: number, range: EnergyRange): string {
  const date = new Date(epochSeconds * 1000);
  if (range === "month") return date.toLocaleDateString([], { month: "short" }); // Jul
  if (range === "day" || range === "week") {
    return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Measured render width at 9px IBM Plex Mono: "12:00 AM" = 42px, "7/16" ≈ 30,
 *  "Jul" ≈ 26. This is the true glyph width, not a padded estimate — a label
 *  may sit right up against its neighbour, since the blank columns the stride
 *  skips give it room to spill. Padding it (the old 46) made Today, whose
 *  hourly columns are ~45px, round up to every-other-label for no real reason. */
function labelWidthFor(range: EnergyRange): number {
  if (range === "month") return 26;
  if (range === "day" || range === "week") return 30;
  return 42;
}

export interface RangeBarColumn {
  key: number | string;
  label: string;
  /** Native tooltip for the whole column, and the text shown in the hover chip. */
  title: string;
  /** Fills the plot row — a bar, a stack, or the "no data" wash. */
  bar: ReactNode;
}

/** A left-edge value scale, when the caller wants one (usage charts do; Energy
 *  opts out and keeps its bare bars). Ticks are drawn top→bottom from max to 0. */
export interface RangeBarYAxis {
  max: number;
  format: (value: number) => string;
  /** Number of ticks including max and 0. Default 3 (max, mid, 0). */
  ticks?: number;
}

interface RangeBarsProps {
  columns: RangeBarColumn[];
  range: EnergyRange;
  /** Override the per-range label width used for stride — e.g. narrow day
   *  numbers fit far more labels than a 42px clock time, so passing ~16 stops
   *  the every-other-day skipping. */
  labelWidthPx?: number;
  /** Plot height in px. Defaults to the compact 96 the Energy sheet uses. */
  heightPx?: number;
  yAxis?: RangeBarYAxis;
}

function YAxis({ yAxis, heightPx }: { yAxis: RangeBarYAxis; heightPx: number }) {
  const count = Math.max(yAxis.ticks ?? 3, 2);
  const values = Array.from({ length: count }, (_, i) => (yAxis.max * (count - 1 - i)) / (count - 1));
  return (
    <div className="energy-yaxis" style={{ height: heightPx }}>
      <div className="energy-yaxis-ticks">
        {values.map((value, i) => (
          <span key={i}>{yAxis.format(value)}</span>
        ))}
      </div>
      {/* Invisible label matching the x-axis row height, so the 0 tick lines up
          with the bar baseline rather than the bottom of the label. */}
      <span className="energy-bar-label" style={{ visibility: "hidden" }}>0</span>
    </div>
  );
}

export function RangeBars({ columns, range, labelWidthPx, heightPx = 96, yAxis }: RangeBarsProps) {
  const [barsRef, barsWidth] = useElementWidth<HTMLDivElement>();
  // Skip labels only when the width genuinely forces it.
  const labelEvery = labelStride(barsWidth, columns.length, labelWidthPx ?? labelWidthFor(range));
  if (columns.length === 0) return null;
  const bars = (
    <div className="energy-bars" ref={barsRef} style={{ height: heightPx }}>
      {columns.map((column, index) => (
        // No native title — it duplicates the hover chip below.
        <div key={column.key} className="energy-bar-col">
          <div className="energy-bar-plot">{column.bar}</div>
          <div className="energy-bar-tip" role="tooltip">
            {column.title}
          </div>
          {/* Skipped labels keep their box so the label row stays one height. */}
          <span
            className="energy-bar-label"
            style={{ visibility: index % labelEvery === 0 ? undefined : "hidden" }}
          >
            {column.label}
          </span>
        </div>
      ))}
    </div>
  );
  if (!yAxis) return bars;
  return (
    <div className="energy-bars-axis">
      <YAxis yAxis={yAxis} heightPx={heightPx} />
      <div className="min-w-0 flex-1">{bars}</div>
    </div>
  );
}
