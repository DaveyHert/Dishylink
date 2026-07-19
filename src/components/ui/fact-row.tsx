// Fact list: a grid of hairline-divided rows, each a muted label on the left and
// a value on the right. FactGrid sets the column count; FactRow owns the row
// layout and label. The value is passed as children so the caller controls its
// styling — the terminal truncates it to one line, alignment lets it wrap.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FactGridProps {
  /** Base column count above the 1080px breakpoint; collapses to one below it. */
  columns?: 2 | 3;
  className?: string;
  children: ReactNode;
}

export function FactGrid({ columns = 2, className, children }: FactGridProps) {
  return (
    <div
      data-slot="fact-grid"
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

interface FactRowProps {
  label: ReactNode;
  className?: string;
  /** The value node — styled by the caller. */
  children: ReactNode;
}

export function FactRow({ label, className, children }: FactRowProps) {
  return (
    <div
      data-slot="fact-row"
      className={cn("flex items-baseline justify-between gap-4 border-b border-border py-[7px]", className)}
    >
      <span data-slot="fact-label" className="flex-none text-[13px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
