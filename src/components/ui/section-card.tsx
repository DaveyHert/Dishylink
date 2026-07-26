// The dashboard's card shell: surface panel, header row with a title and an
// optional right-side caption (`meta`) or custom content (`headerAction`).
// Grid placement (col-span, etc.) comes in via `className`.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: ReactNode;
  /** Muted caption on the right of the header. */
  meta?: ReactNode;
  /** Custom right-side header content (legend, controls); replaces `meta`. */
  headerAction?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function SectionCard({ title, meta, headerAction, className, children }: SectionCardProps) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-card px-[18px] py-4", className)}>
      <div className='mb-2.5 flex items-center justify-between gap-3'>
        <span className='text-[16px] font-semibold tracking-[0.005em] text-foreground'>
          {title}
        </span>
        {headerAction ??
          (meta ? (
            <span className='text-[12px] font-medium text-muted-foreground'>{meta}</span>
          ) : null)}
      </div>
      {children}
    </div>
  );
}
