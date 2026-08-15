import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Dishylink switch: explicit track/thumb sizing so the thumb pins hard left
// (off) / hard right (on) instead of floating mid-track. The knob always
// contrasts its track — a light knob on the subtle off-track, a dark knob on
// the softened (never pure-white) on-track — so neither state reads as a
// bright outline in dark mode.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot='switch'
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-[color-mix(in_srgb,var(--ink)_78%,var(--baseline))]",
        "data-[state=unchecked]:bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot='switch-thumb'
        className={cn(
          "pointer-events-none block size-3.5 rounded-full shadow-sm transition-transform",
          "data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-card",
          "data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-ink-secondary",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
