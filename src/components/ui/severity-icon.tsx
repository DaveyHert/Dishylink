// The icon that carries "how loud is this?" — the ⓘ beside a setting, the mark in
// a callout, whatever comes next. Colour is defined here and nowhere else, so two
// icons of the same severity cannot drift apart.
//
// normal — reads with the text around it.
// warn   — something that can cost the user their connection.
// danger — something already broken, or a value they cannot undo from here.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Severity = "normal" | "warn" | "danger";

const iconColor: Record<Severity, string> = {
  normal: "",
  warn: "text-(--accent)",
  danger: "text-status-critical",
};

/** The bordered ⓘ dot is interactive, so it needs border and hover states rather
 *  than the text colour a plain glyph gets. */
export const dotSeverityClass: Record<Severity, string> = {
  normal:
    "border-input text-muted-foreground hover:border-(--accent) hover:text-(--accent) focus-visible:border-(--accent) focus-visible:text-(--accent)",
  warn: "border-(--accent) text-(--accent) hover:opacity-80 focus-visible:opacity-80",
  danger: "border-status-critical text-status-critical hover:opacity-80 focus-visible:opacity-80",
};

/** Carries severity by colour alone, so it is hidden from assistive tech:
 *  whatever it marks has to say the same thing in words. */
export function SeverityIcon({
  severity,
  className,
  children,
}: {
  severity: Severity;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span aria-hidden='true' className={cn(iconColor[severity], className)}>
      {children}
    </span>
  );
}
