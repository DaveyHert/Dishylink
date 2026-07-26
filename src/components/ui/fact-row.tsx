// Fact list: a grid of hairline-divided rows, each a muted label on the left and
// a value on the right. FactGrid sets the column count; FactRow owns the row
// layout and label. The value is passed as children so the caller controls its
// styling — the terminal truncates it to one line, alignment lets it wrap.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoDot } from "../shared/InfoDot";

interface FactGridProps {
  /** Base column count above the 1080px breakpoint; collapses to one below it. */
  columns?: 2 | 3;
  className?: string;
  children: ReactNode;
}

export function FactGrid({ columns = 2, className, children }: FactGridProps) {
  return (
    <div
      data-slot='fact-grid'
      className={cn(
        "grid gap-x-8 gap-y-1 max-[1080px]:grid-cols-1",
        columns === 3 ? "grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface FactColumnProps {
  className?: string;
  children: ReactNode;
}

/**
 * Side-by-side fact columns, stacking below the 1080px breakpoint.
 *
 * Use this instead of FactGrid wherever a column *means* something. FactGrid
 * flows one list of rows across N columns, so a row's column is its index
 * parity — inserting a row silently pushes every row after it into the other
 * column. Here each column owns its own rows and can't disturb its neighbour.
 */
export function FactColumns({ className, children }: FactColumnProps) {
  return (
    <div
      data-slot='fact-columns'
      className={cn("grid grid-cols-2 gap-x-8 max-[1080px]:grid-cols-1", className)}
    >
      {children}
    </div>
  );
}

/** One column of facts. Its bottom row has nothing under it, so it sheds its rule. */
export function FactColumn({ className, children }: FactColumnProps) {
  return (
    <div
      data-slot='fact-column'
      className={cn("flex flex-col gap-y-1 [&>*:last-child]:border-b-0", className)}
    >
      {children}
    </div>
  );
}

interface FactRowProps {
  label: ReactNode;
  /** Plain-language explanation of the label, revealed by an ⓘ beside it. */
  hint?: string;
  className?: string;
  /** The value node — styled by the caller. */
  children: ReactNode;
}

export function FactRow({ label, hint, className, children }: FactRowProps) {
  return (
    <div
      data-slot='fact-row'
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-border py-[7px]",
        className,
      )}
    >
      <span
        data-slot='fact-label'
        className='inline-flex flex-none items-center gap-[5px] text-[13px] font-medium text-muted-foreground'
      >
        {label}
        {hint && <InfoDot tip={hint} />}
      </span>
      {children}
    </div>
  );
}
