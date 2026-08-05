// The "Download" / "Upload" line under the big number, shared by the gauge and the
// beam so the two views can't drift apart. The arrow carries the dashboard's series
// colour — the same blue and green the throughput charts use — the only thing
// colouring the phase, since the beam itself reads one colour throughout.
//
// Idle and failed captions ("Ready", "Failed") name no direction, so they get no arrow.

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

export type SpeedMode = "download" | "upload" | "idle";

export function SpeedCaption({ mode, caption }: { mode: SpeedMode; caption: string }) {
  const Arrow = mode === "upload" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <div className='-mt-1.5 flex items-center justify-center gap-[3px] text-[12px] font-semibold text-ink-muted'>
      {mode !== "idle" && (
        <Arrow
          size={12}
          strokeWidth={2.5}
          color={mode === "upload" ? "var(--series-up)" : "var(--series-down)"}
          aria-hidden
        />
      )}
      {caption}
    </div>
  );
}
