// A message set apart from the content it explains: an icon plus text in a tinted box.
//
// tone="info"  — advisory. "here is something worth knowing."
// tone="error" — something is broken and the user can act on it.
//
// Every advisory and every failure in the app comes through here, so a broken thing
// can never be styled like a pending one — an error that reads as "…" in progress is
// the failure mode this primitive exists to prevent.
//
// Spacing is left to the caller: margin is contextual, not part of the primitive.
//
// Exact values enforced by callout.test.tsx.

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const callout = cva(
  "flex items-start gap-2.5 rounded-lg px-[13px] py-[11px] text-[12.5px] leading-normal",
  {
    variants: {
      tone: {
        info: "bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] text-[var(--ink-secondary)]",
        error:
          "bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface))] text-[var(--ink-secondary)]",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const ICON: Record<NonNullable<VariantProps<typeof callout>["tone"]>, string> = {
  info: "ⓘ",
  error: "⚠",
};

interface CalloutProps extends VariantProps<typeof callout> {
  children: ReactNode;
  className?: string;
}

export function Callout({ children, tone, className }: CalloutProps) {
  const resolvedTone = tone ?? "info";
  return (
    <div
      data-slot='callout'
      data-tone={resolvedTone}
      // An error is a status message: announce it without the user having to find it.
      role={resolvedTone === "error" ? "alert" : undefined}
      className={cn(callout({ tone }), className)}
    >
      <span
        aria-hidden='true'
        className={resolvedTone === "error" ? "text-[var(--status-critical)]" : undefined}
      >
        {ICON[resolvedTone]}
      </span>
      <span>{children}</span>
    </div>
  );
}
