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
import { SeverityIcon, type Severity } from "./severity-icon";

const callout = cva(
  "flex items-start gap-2.5 rounded-lg px-[13px] py-[11px] text-[12.5px] leading-normal",
  {
    variants: {
      tone: {
        info: "bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] text-ink-secondary",
        error:
          "bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface))] text-ink-secondary",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const GLYPH = {
  note: "ⓘ",
  warning: "⚠",
} as const;

interface CalloutProps extends VariantProps<typeof callout> {
  children: ReactNode;
  /** How hard the icon presses, independent of the box it sits in. */
  iconSeverity?: Severity;
  /** The glyph, for a warning that is not a failure: the triangle without the
   *  red box behind it. Defaults to the one the tone implies. */
  icon?: keyof typeof GLYPH;
  /** Given only where the reader can be done with this for good. A message they
   *  still need is not dismissible. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

export function Callout({
  children,
  tone,
  iconSeverity,
  icon,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
}: CalloutProps) {
  const resolvedTone = tone ?? "info";
  // A broken thing is never quieter than its box, so the error tone settles this.
  const severity = resolvedTone === "error" ? "danger" : (iconSeverity ?? "normal");
  return (
    <div
      data-slot='callout'
      data-tone={resolvedTone}
      // An error is a status message: announce it without the user having to find it.
      role={resolvedTone === "error" ? "alert" : undefined}
      className={cn(callout({ tone }), className)}
    >
      <SeverityIcon severity={severity}>
        {GLYPH[icon ?? (resolvedTone === "error" ? "warning" : "note")]}
      </SeverityIcon>
      <span>{children}</span>
      {onDismiss && (
        <button
          type='button'
          aria-label={dismissLabel}
          onClick={onDismiss}
          className='-my-0.5 -mr-1 ml-auto inline-flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-0 bg-transparent text-[11px] text-ink-secondary/70 hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink'
        >
          ✕
        </button>
      )}
    </div>
  );
}
