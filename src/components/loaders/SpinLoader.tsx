import { motion } from "motion/react";

/**
 * SpinLoader — three spinner treatments behind one `variant` prop.
 *
 *   "conic"    — a gradient arc sweeping around a ring. The quietest option.
 *   "activity" — twelve fading spokes rotating around a center (Apple style).
 *   "segment"  — a solid track with one bright arc. The universal workhorse.
 *
 * Everything paints in the inherited text color.
 *
 * The rotation IS the message: it is the only thing separating "still working"
 * from "stalled". Nothing in this app dims its motion for
 * `prefers-reduced-motion` — the animations here are the live readings, not
 * decoration, and freezing them tells the reader strictly less. Where holding
 * still is genuinely wanted, it is offered as a control instead: see the
 * obstruction dome's pause.
 */

const INK = "currentColor";
// Faint same-hue track, so the ring reads on both light and dark grounds.
const TRACK = "color-mix(in srgb, currentColor 16%, transparent)";

const SPIN = { duration: 1, repeat: Infinity, ease: "linear" as const };

export type SpinLoaderVariant = "conic" | "activity" | "segment";

interface SpinLoaderProps {
  size?: number;
  variant?: SpinLoaderVariant;
  /** Announced to screen readers; also the root's aria-label. */
  label?: string;
}

export function SpinLoader({ size = 48, variant = "conic", label = "Loading" }: SpinLoaderProps) {
  const shared = { size, label };

  switch (variant) {
    case "activity":
      return <ActivitySpinner {...shared} />;
    case "segment":
      return <SegmentSpinner {...shared} />;
    default:
      return <ConicSpinner {...shared} />;
  }
}

interface VariantProps {
  size: number;
  label: string;
}

// ── conic ──────────────────────────────────────────────────────────────────
// A conic gradient masked into a ring, rotating.
function ConicSpinner({ size, label }: VariantProps) {
  const thickness = Math.max(4, Math.round(size * 0.1));
  const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 calc(100% - ${thickness - 1}px))`;

  return (
    <motion.div
      role='status'
      aria-label={label}
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        background: `conic-gradient(from 0deg, transparent 0%, ${INK} 85%, ${INK} 100%)`,
        WebkitMask: ringMask,
        mask: ringMask,
      }}
      animate={{ rotate: 360 }}
      transition={SPIN}
    />
  );
}

// ── segment ────────────────────────────────────────────────────────────────
// A solid faint track with one accent arc, rotating.
function SegmentSpinner({ size, label }: VariantProps) {
  const width = Math.max(4, Math.round(size * 0.1));
  return (
    <motion.div
      role='status'
      aria-label={label}
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        border: `${width}px solid ${TRACK}`,
        borderTopColor: INK,
      }}
      animate={{ rotate: 360 }}
      transition={{ ...SPIN, duration: 0.8 }}
    />
  );
}

// ── activity ───────────────────────────────────────────────────────────────
// Twelve spokes around a center, each fading in turn so the bright point travels.
function ActivitySpinner({ size, label }: VariantProps) {
  const pivot = size * 0.3636; // distance from center to each spoke's rotation origin
  const spokeWidth = Math.max(2, size * 0.068);
  const spokeHeight = size * 0.2727;

  return (
    <div
      role='status'
      aria-label={label}
      style={{ position: "relative", width: size, height: size, flex: "none" }}
    >
      {Array.from({ length: 12 }, (_, spoke) => (
        <motion.span
          key={spoke}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: spokeWidth,
            height: spokeHeight,
            marginTop: -pivot,
            marginLeft: -spokeWidth / 2,
            borderRadius: spokeWidth,
            background: INK,
            transformOrigin: `${spokeWidth / 2}px ${pivot}px`,
            transform: `rotate(${spoke * 30}deg)`,
          }}
          animate={{ opacity: [1, 0.15] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "linear",
            delay: -((11 - spoke) / 12),
          }}
        />
      ))}
    </div>
  );
}
