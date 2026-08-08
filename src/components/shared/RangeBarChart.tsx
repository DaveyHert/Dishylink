// The bar chart shared by the Power (energy) and Data usage panels: range tabs,
// a plot row, and a label row. Both panels draw the same frame and differ only
// in what fills a column, so the frame lives here and the bar comes in as a node.
//
// Layout note: the plot and label rows are declared once on the chart and each
// column adopts them via `subgrid`. A column must not be able to size its own bar
// box — one that skips its label would otherwise hand the reclaimed height to its
// bar, staggering the baselines and scaling that bar against a taller box than its
// neighbours.

import type { ReactNode } from "react";
import { useElementWidth, labelStride } from "../../hooks/useElementWidth";
import type { EnergyRange } from "../../hooks/useEnergyHistory";

/** Measured render width at 9px IBM Plex Mono: "12:00 AM" = 42px, "7/16" ≈ 30,
 *  "Jul" ≈ 26. True glyph width, deliberately unpadded — a label may sit right up
 *  against its neighbour, since the blank columns the stride skips give it room to
 *  spill. Rounding these up costs whole labels: Today's hourly columns are ~45px,
 *  so a padded 46 would drop it to every other label for no visual gain. */
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
  /** Plot height in px. Defaults to the compact 96 the Energy panel uses. */
  heightPx?: number;
  yAxis?: RangeBarYAxis;
}

function YAxis({ yAxis, heightPx }: { yAxis: RangeBarYAxis; heightPx: number }) {
  const count = Math.max(yAxis.ticks ?? 3, 2);
  const values = Array.from(
    { length: count },
    (_, i) => (yAxis.max * (count - 1 - i)) / (count - 1),
  );
  return (
    <div className='flex flex-none flex-col items-end' style={{ height: heightPx }}>
      <div className='flex min-h-0 flex-1 flex-col items-end justify-between font-mono text-[9px] text-ink-muted'>
        {values.map((value, i) => (
          <span key={i}>{yAxis.format(value)}</span>
        ))}
      </div>
      {/* Invisible label matching the x-axis row height, so the 0 tick lines up
          with the bar baseline rather than the bottom of the label. */}
      <span
        className='mt-1 font-mono text-[9px] whitespace-nowrap text-ink-muted'
        style={{ visibility: "hidden" }}
      >
        0
      </span>
    </div>
  );
}

export function RangeBars({ columns, range, labelWidthPx, heightPx = 96, yAxis }: RangeBarsProps) {
  const [barsRef, barsWidth] = useElementWidth<HTMLDivElement>();
  // Skip labels only when the width genuinely forces it.
  const labelEvery = labelStride(barsWidth, columns.length, labelWidthPx ?? labelWidthFor(range));
  if (columns.length === 0) return null;
  const bars = (
    <div className='mt-3 flex items-end gap-[3px]' ref={barsRef} style={{ height: heightPx }}>
      {columns.map((column, index) => (
        // No native title — it duplicates the hover chip below. `group` reveals
        // the tip on column hover.
        <div
          key={column.key}
          className='group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end'
        >
          <div className='flex min-h-0 w-full flex-1 items-end'>{column.bar}</div>
          <div
            className='pointer-events-none absolute bottom-[calc(100%-12px)] left-1/2 z-[6] -translate-x-1/2 rounded-[6px] bg-ink px-2 py-1 text-[11px] font-medium whitespace-nowrap text-card opacity-0 transition-opacity duration-100 group-hover:opacity-100'
            role='tooltip'
          >
            {column.title}
          </div>
          {/* Skipped labels keep their box so the label row stays one height. */}
          <span
            className='mt-1 font-mono text-[9px] whitespace-nowrap text-ink-muted'
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
    <div className='flex gap-2'>
      <YAxis yAxis={yAxis} heightPx={heightPx} />
      <div className='min-w-0 flex-1'>{bars}</div>
    </div>
  );
}
