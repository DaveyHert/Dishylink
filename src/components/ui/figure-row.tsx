// The row of big numbers at the top of a detail panel: "10.5 Mbps / Average".
//
// One definition shared by every detail panel, dividers included: "a hairline
// between each pair" is the row's job, not something each caller places by hand and
// gets subtly differently.
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
  /** "lg" is the panel's headline pair; "sm" is a secondary section's figures,
   *  smaller so they sit under the headline rather than rival it. */
  size?: "lg" | "sm";
}

// Two typographic scales for the same markup: the headline pair and the smaller
// pair a secondary section (router ping success) shows beneath it.
const SIZES = {
  lg: { gap: "gap-7", value: "text-[36px]", unit: "text-[14px]", label: "text-[12px]" },
  sm: { gap: "gap-6", value: "text-[26px]", unit: "text-[12px]", label: "text-[11px]" },
} as const;

export function FigureRow({ figures, className, size = "lg" }: FigureRowProps) {
  const scale = SIZES[size];
  return (
    <div
      data-slot='figure-row'
      className={cn("mt-3 mb-3.5 flex items-center", scale.gap, className)}
    >
      {figures.map((figure, index) => (
        <Fragment key={figure.label}>
          {index > 0 && <div data-slot='figure-divider' className='w-px self-stretch bg-border' />}
          <div data-slot='figure'>
            {/* Font-size class first: in Tailwind v4 `text-[…]` carries a
                line-height, so it must precede `leading-[1.05]` or tailwind-merge
                drops the explicit leading (figure-row.test enforces 37.8px). */}
            <div className={cn(scale.value, "leading-[1.05] font-bold tracking-[-0.01em]")}>
              {figure.value}
              <span className={cn("ml-[5px] font-medium text-muted-foreground", scale.unit)}>
                {figure.unit}
              </span>
            </div>
            <div className={cn("mt-0.5 font-medium text-muted-foreground", scale.label)}>
              {figure.label}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
