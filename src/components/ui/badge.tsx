// The app's pill vocabulary, in one place.
//
// Not shadcn's stock Badge, which is built on primary/secondary theme tokens:
// this app speaks in --ink / --baseline / --status-* with mono, tabular type. One
// definition per pill shape, so the same chip on two surfaces cannot drift apart
// in size or in how it names a colour.
//
// Three shapes cover every use:
//   spec   — a machine fact: band, firmware, hardware, auth state
//   tag    — a terse marker on something small (DTC, serving)
//   status — a word about state, in its own colour (Active)

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Semantic colour, so a call site never hand-writes a CSS variable pair. */
const TONE_VAR = {
  neutral: undefined,
  good: "var(--status-good)",
  critical: "var(--status-critical)",
  warm: "var(--chart-warm)",
} as const;

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap",
  {
    variants: {
      variant: {
        spec: "rounded-[6px] border border-input px-[7px] py-0.5 font-mono text-[10px] tracking-[0.04em] text-ink-secondary tabular-nums",
        tag: "rounded border border-input px-[5px] py-px font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-secondary",
        status: "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
      },
    },
    defaultVariants: { variant: "spec" },
  },
);

export function Badge({
  className,
  variant,
  tone = "neutral",
  style,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Colours both text and border; neutral keeps the variant's own colours. */
    tone?: keyof typeof TONE_VAR;
  }) {
  const toneColor = TONE_VAR[tone];
  return (
    <span
      data-slot='badge'
      className={cn(badgeVariants({ variant }), className)}
      style={toneColor ? { color: toneColor, borderColor: toneColor, ...style } : style}
      {...props}
    />
  );
}
