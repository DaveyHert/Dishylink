// The mark that says how loud something is, in the one place its colours live.
//
// normal — reads with the text around it.
// warn   — something that can cost the user their connection.
// danger — something already broken, or a value they cannot undo from here.

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Severity = "normal" | "warn" | "danger";

const iconColor: Record<Severity, string> = {
  normal: "",
  warn: "text-(--accent)",
  danger: "text-status-critical",
};

// The dot is interactive, so each severity also carries its border and its hover
// and focus states.
const dotColor: Record<Severity, string> = {
  normal:
    "border-input text-muted-foreground hover:border-(--accent) hover:text-(--accent) focus-visible:border-(--accent) focus-visible:text-(--accent)",
  warn: "border-(--accent) text-(--accent) hover:opacity-80 focus-visible:opacity-80",
  danger: "border-status-critical text-status-critical hover:opacity-80 focus-visible:opacity-80",
};

const dotShape =
  "relative inline-flex size-[13px] cursor-help items-center justify-center rounded-full border font-mono text-[9px] italic leading-none outline-none [transition:border-color_120ms_ease,color_120ms_ease,opacity_120ms_ease]";

/** A glyph that carries severity by colour alone, so it is hidden from assistive
 *  tech: whatever it marks has to say the same thing in words. */
export function SeverityIcon({
  severity = "normal",
  className,
  children,
}: {
  severity?: Severity;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span aria-hidden='true' className={cn(iconColor[severity], className)}>
      {children}
    </span>
  );
}

/** The bordered ⓘ. Every other prop passes through, so a tooltip library can make
 *  it a trigger. */
export function SeverityDot({
  severity = "normal",
  className,
  ...props
}: ComponentPropsWithoutRef<"span"> & { severity?: Severity }) {
  return (
    <span {...props} className={cn(dotShape, dotColor[severity], className)}>
      i
    </span>
  );
}
