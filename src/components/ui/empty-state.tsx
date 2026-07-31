// "There is nothing here" — the third state alongside Loading and Callout tone="error".
// Distinct from both: nothing is pending, nothing is wrong, there is simply no data.
//
// Spacing is left to the caller: a card and a popover want different padding.
//
// Exact values enforced by empty-state.test.tsx.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  children: ReactNode;
  className?: string;
}

export function EmptyState({ children, className }: EmptyStateProps) {
  return (
    <p
      data-slot='empty-state'
      className={cn("text-center text-[13px] font-medium text-muted-foreground", className)}
    >
      {children}
    </p>
  );
}
