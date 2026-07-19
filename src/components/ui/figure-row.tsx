// The row of big numbers at the top of a detail panel: "10.5 Mbps / Average".
//
// StatDetailPanel had a private BigNumber for this; DataUsagePanel hand-rolled the same
// markup three times. Both also placed the hairline dividers by hand — the row owns that
// now, since "a divider between each pair" is the row's job, not the caller's.
//
// Exact values enforced by figure-row.test.tsx.

import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface Figure {
  value: string;
  unit: string;
  label: string;
}

interface FigureRowProps {
  figures: Figure[];
  className?: string;
}

export function FigureRow({ figures, className }: FigureRowProps) {
  return (
    <div data-slot="figure-row" className={cn("mt-3 mb-3.5 flex items-center gap-7", className)}>
      {figures.map((figure, index) => (
        <Fragment key={figure.label}>
          {index > 0 && <div data-slot="figure-divider" className="w-px self-stretch bg-border" />}
          <div data-slot="figure">
            <div className="text-[36px] leading-[1.05] font-bold tracking-[-0.01em]">
              {figure.value}
              <span className="ml-[5px] text-[14px] font-medium text-muted-foreground">{figure.unit}</span>
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">{figure.label}</div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
