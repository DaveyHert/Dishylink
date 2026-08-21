// How a rule reads back, shared so one figure never draws two ways across the
// Rules list, a rule's status and a device's card.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Bar({ spent, tone }: { spent: number; tone: string }) {
  return (
    <div className='h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'>
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${Math.min(100, Math.max(0, spent) * 100)}%` }}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  align = "left",
}: {
  label: string;
  value: string;
  tone?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <div className={align === "center" ? "text-center" : align === "right" ? "text-right" : ""}>
      <div className='text-[12px] text-muted-foreground'>{label}</div>
      <div className={cn("text-[15px] font-semibold tabular-nums", tone ?? "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

export function RuleStats({ children }: { children: ReactNode }) {
  return <div className='grid grid-cols-3 gap-3 border-t border-border/60 pt-4'>{children}</div>;
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='space-y-2 border-t border-border/60 pt-4'>
      <div className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</div>
      {children}
    </div>
  );
}
