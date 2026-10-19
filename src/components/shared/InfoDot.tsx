// The ⓘ affordance that reveals a plain-language tip on hover/focus. Shared by
// the satellite-view stat captions, the Network drill-in, and the alerts
// dropdown, so every "what does this mean?" hint in the app looks and behaves
// the same.
//
// The tip is portalled (Radix) rather than absolutely positioned inside the dot:
// a CSS-only tip is clipped by any scrolling or overflow-hidden ancestor — which
// is exactly what the alerts dropdown is — and has to be nudged by hand near a
// screen edge. Portalling escapes the clip and collision detection handles the
// edges, so the same dot works anywhere it is dropped.

import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { SeverityDot, type Severity } from "../ui/severity-icon";

// Portalled by Radix, so this is presentation only — the resets (not-italic,
// normal-case, tracking-normal) guard against whatever context it lands in.
const infoTip =
  "z-[60] w-max max-w-[360px] rounded-lg border border-hairline bg-secondary px-[13px] py-[11px] text-left text-[12.5px] not-italic normal-case leading-normal tracking-normal text-ink-secondary shadow-[0_6px_24px_rgba(0,0,0,0.28)]";

/** Standalone ⓘ dot. Pair with any heading. */
export function InfoDot({ tip, severity = "normal" }: { tip: string; severity?: Severity }) {
  return (
    <TooltipPrimitive.Provider delayDuration={120}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <SeverityDot severity={severity} tabIndex={0} role='note' aria-label={tip} />
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={infoTip}
            side='top'
            align='start'
            sideOffset={8}
            collisionPadding={12}
          >
            {tip}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** A stat caption with an ⓘ affordance — used to explain what each metric means. */
export function StatLabel({
  children,
  tip,
  className,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] text-[11.5px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
      <InfoDot tip={tip} />
    </span>
  );
}
