// Ookla-style circular speed gauge. The dial itself is GaugeDial; what lives
// here is the scale — a sqrt mapping from Mbps onto the dial's sweep, so low
// speeds still move the needle — and the easing.
//
// The needle/fill/number ease toward the target value each frame (rAF) so the
// gauge glides like a real speedometer instead of snapping: SVG geometry
// attributes can't be CSS-transitioned, so we animate the value itself.

import { GaugeDial, type GaugeTick } from "../../assets/icons/GaugeDial";
import { useEasedValue } from "../../hooks/useEasedValue";
import { SpeedCaption } from "./SpeedCaption";

const MAX_MBPS = 500;
const TICKS = [0, 10, 25, 50, 100, 200, 350, 500];

/** Non-linear position 0..1 for a speed (sqrt spreads out the low end). */
function fractionFor(mbps: number): number {
  const clamped = Math.max(0, Math.min(mbps, MAX_MBPS));
  return Math.sqrt(clamped) / Math.sqrt(MAX_MBPS);
}

const DIAL_TICKS: GaugeTick[] = TICKS.map((tick) => ({
  label: String(tick),
  fraction: fractionFor(tick),
}));

interface SpeedGaugeProps {
  /** Current value the needle points to, in Mbps. */
  value: number | null;
  /** "download" | "upload" tints the fill; anything else is neutral. */
  mode: "download" | "upload" | "idle";
  /** Caption under the big number, e.g. "Download". */
  caption: string;
}

export function SpeedGauge({ value, mode, caption }: SpeedGaugeProps) {
  const eased = useEasedValue(value ?? 0);
  const pending = value === null && eased < 0.1;

  return (
    <div className='flex w-full flex-col items-center'>
      <GaugeDial
        fraction={fractionFor(eased)}
        ticks={DIAL_TICKS}
        color={mode === "upload" ? "var(--chart-warm)" : "var(--chart-ink)"}
        // one decimal at every magnitude — see the same readout in SpeedBeam
        value={pending ? "0" : eased.toFixed(1)}
        unit='Mbps'
        muted={pending}
        className='h-auto w-full max-w-[300px]'
        role='img'
        aria-label={`${caption} ${value?.toFixed(1) ?? "—"} Mbps`}
      />
      <SpeedCaption mode={mode} caption={caption} />
    </div>
  );
}
