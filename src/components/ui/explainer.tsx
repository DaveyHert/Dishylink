// The "What is latency?" block at the foot of a detail panel: a titled, bordered box
// explaining the metric above it. Boxing it is what makes it read as an aside
// rather than as more panel.
//
// Distinct from Callout: that is a short advisory with an icon; this is titled
// educational prose with no icon, and it is always the last thing in a panel.
//
// Exact values enforced by explainer.test.tsx.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ExplainerProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function Explainer({ title, children, className }: ExplainerProps) {
  return (
    <div
      data-slot='explainer'
      className={cn(
        "mt-4 rounded-xl border border-hairline px-[14px] py-[13px] text-[13.5px] leading-[1.55] text-ink-secondary",
        className,
      )}
    >
      <div data-slot='explainer-title' className='mb-1 text-[14.5px] font-[650] text-foreground'>
        {title}
      </div>
      {children}
    </div>
  );
}
