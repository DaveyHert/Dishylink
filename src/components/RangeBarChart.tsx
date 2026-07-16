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
import { useElementWidth, labelStride } from "../hooks/useElementWidth";
import type { EnergyRange } from "../hooks/useEnergyHistory";

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
  /** Native tooltip for the whole column. */
  title: string;
  /** Fills the plot row — a bar, a stack, or the "no data" wash. */
  bar: ReactNode;
}

export function RangeBars({ columns, range }: { columns: RangeBarColumn[]; range: EnergyRange }) {
  const [barsRef, barsWidth] = useElementWidth<HTMLDivElement>();
  // Skip labels only when the width genuinely forces it.
  const labelEvery = labelStride(barsWidth, columns.length, labelWidthFor(range));
  if (columns.length === 0) return null;
  return (
    <div className="energy-bars" ref={barsRef}>
      {columns.map((column, index) => (
        <div key={column.key} className="energy-bar-col" title={column.title}>
          <div className="energy-bar-plot">{column.bar}</div>
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
}
