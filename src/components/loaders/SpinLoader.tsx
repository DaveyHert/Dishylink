import { motion, useReducedMotion } from "motion/react";

/**
 * SpinLoader — four classic spinner treatments behind one `variant` prop.
 * Separate from JobMateLoader (the elaborate mark-tracing loader); this is the
 * lightweight, "just a spinner" set.
 *
 *   "conic"    — a gradient arc sweeping around a ring. The quietest option.
 *   "activity" — twelve fading spokes rotating around a center (Apple style).
 *   "orbit"    — a segment ring turning around the fixed JobMate mark.
 *   "segment"  — a solid track with one bright arc. The universal workhorse.
 *
 * Everything paints in the brand indigo (`--color-brand-accent`), set once on
 * the root `color` so children inherit it via `currentColor`. Respects
 * `prefers-reduced-motion` by holding a static frame.
 */

// The JobMate mark — first path of JobMateLogo.tsx, centred in a 47×47 box.
const MARK_PATH =
  "M23.4468 3.9078H41.0319V16.9338V29.9598H23.4468V42.9858H5.86169V29.9598V16.9338H23.4468V3.9078Z";

const BRAND_INK = "var(--color-brand-accent)";
// Faint same-hue track, so the ring reads on both light and dark grounds.
const TRACK = "color-mix(in srgb, var(--color-brand-accent) 16%, transparent)";

const SPIN = { duration: 1, repeat: Infinity, ease: "linear" as const };

export type SpinLoaderVariant = "conic" | "activity" | "orbit" | "segment";

interface SpinLoaderProps {
  size?: number;
  variant?: SpinLoaderVariant;
  /** Announced to screen readers; also the root's aria-label. */
  label?: string;
}

export function SpinLoader({ size = 48, variant = "conic", label = "Loading" }: SpinLoaderProps) {
  const reduce = useReducedMotion() ?? false;
  const shared = { size, reduce, label };

  switch (variant) {
    case "activity":
      return <ActivitySpinner {...shared} />;
    case "orbit":
      return <OrbitSpinner {...shared} />;
    case "segment":
      return <SegmentSpinner {...shared} />;
    default:
      return <ConicSpinner {...shared} />;
  }
}

interface VariantProps {
  size: number;
  reduce: boolean;
  label: string;
}

// ── conic ──────────────────────────────────────────────────────────────────
// A conic gradient masked into a ring, rotating.
function ConicSpinner({ size, reduce, label }: VariantProps) {
  const thickness = Math.max(4, Math.round(size * 0.1));
  const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 calc(100% - ${thickness - 1}px))`;

  return (
    <motion.div
      role="status"
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `conic-gradient(from 0deg, transparent 0%, ${BRAND_INK} 85%, ${BRAND_INK} 100%)`,
        WebkitMask: ringMask,
        mask: ringMask,
      }}
      animate={reduce ? undefined : { rotate: 360 }}
      transition={reduce ? undefined : SPIN}
    />
  );
}

// ── segment ────────────────────────────────────────────────────────────────
// A solid faint track with one accent arc, rotating.
function SegmentSpinner({ size, reduce, label }: VariantProps) {
  const width = Math.max(4, Math.round(size * 0.1));
  return (
    <motion.div
      role="status"
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${width}px solid ${TRACK}`,
        borderTopColor: BRAND_INK,
      }}
      animate={reduce ? undefined : { rotate: 360 }}
      transition={reduce ? undefined : { ...SPIN, duration: 0.8 }}
    />
  );
}

// ── orbit ──────────────────────────────────────────────────────────────────
// A segment ring turning around the fixed JobMate mark.
function OrbitSpinner({ size, reduce, label }: VariantProps) {
  const width = Math.max(4, Math.round(size * 0.055));
  const markSize = Math.round(size * 0.46);
  return (
    <div
      role="status"
      aria-label={label}
      style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}
    >
      <motion.div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `${width}px solid ${TRACK}`,
          borderTopColor: BRAND_INK,
        }}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={reduce ? undefined : { ...SPIN, duration: 0.9 }}
      />
      <svg width={markSize} height={markSize} viewBox="0 0 47 47" fill="currentColor" style={{ color: BRAND_INK }}>
        <path fillRule="evenodd" clipRule="evenodd" d={MARK_PATH} />
      </svg>
    </div>
  );
}

// ── activity ───────────────────────────────────────────────────────────────
// Twelve spokes around a center, each fading in turn so the bright point travels.
function ActivitySpinner({ size, reduce, label }: VariantProps) {
  const pivot = size * 0.3636; // distance from center to each spoke's rotation origin
  const spokeWidth = Math.max(2, size * 0.068);
  const spokeHeight = size * 0.2727;

  return (
    <div
      role="status"
      aria-label={label}
      style={{ position: "relative", width: size, height: size }}
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
            background: BRAND_INK,
            transformOrigin: `${spokeWidth / 2}px ${pivot}px`,
            transform: `rotate(${spoke * 30}deg)`,
          }}
          animate={reduce ? undefined : { opacity: [1, 0.15] }}
          transition={
            reduce
              ? undefined
              : { duration: 1, repeat: Infinity, ease: "linear", delay: -((11 - spoke) / 12) }
          }
        />
      ))}
    </div>
  );
}
