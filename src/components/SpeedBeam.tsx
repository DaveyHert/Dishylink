// Starlink-app-style speed visualization: a dish on a ring "horizon" firing a
// beam up to a satellite on its orbit arc. An alternative to the gauge — same
// { value, mode, caption } contract. During a test the beam pulses and a packet
// travels along it (down = satellite→dish, up = dish→satellite); the big value
// eases like the gauge. Theme-aware via CSS variables.

import { motion, useReducedMotion } from "motion/react";
import { useEasedValue } from "../hooks/useEasedValue";

interface SpeedBeamProps {
  value: number | null;
  mode: "download" | "upload" | "idle";
  caption: string;
}

const DISH: [number, number] = [130, 168];
const SAT: [number, number] = [201, 55];
const RING_RADII = [26, 50, 76, 104, 134];

export function SpeedBeam({ value, mode, caption }: SpeedBeamProps) {
  const reduce = useReducedMotion() ?? false;
  const eased = useEasedValue(value ?? 0);
  const active = mode !== "idle";
  const beamColor = mode === "upload" ? "var(--chart-warm)" : "var(--chart-ink)";
  // Packet direction: download flows down to the dish, upload flows up.
  const from = mode === "upload" ? DISH : SAT;
  const to = mode === "upload" ? SAT : DISH;

  return (
    <div className="speed-beam">
      <svg viewBox="0 0 260 200" className="speed-beam-svg" role="img" aria-label={`${caption} ${value?.toFixed(0) ?? "—"} Mbps`}>
        {/* ground rings (horizon) */}
        {RING_RADII.map((rx, index) => (
          <ellipse key={index} cx={DISH[0]} cy={DISH[1] + 6} rx={rx} ry={rx * 0.24} className="beam-ring" fill="none" />
        ))}

        {/* orbit arc */}
        <path d="M22,74 Q130,18 238,74" className="beam-orbit" fill="none" />

        {/* beam */}
        <motion.line
          x1={DISH[0]}
          y1={DISH[1]}
          x2={SAT[0]}
          y2={SAT[1]}
          stroke={beamColor}
          strokeLinecap="round"
          animate={active && !reduce ? { opacity: [0.4, 1, 0.4], strokeWidth: [1.5, 3, 1.5] } : { opacity: active ? 0.85 : 0.28, strokeWidth: 2 }}
          transition={active && !reduce ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        />

        {/* travelling packet */}
        {active && !reduce && (
          <motion.circle
            r={3.5}
            fill={beamColor}
            initial={false}
            animate={{ cx: [from[0], to[0]], cy: [from[1], to[1]], opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        )}

        {/* satellite */}
        <circle cx={SAT[0]} cy={SAT[1]} r={12} fill="none" stroke={beamColor} strokeOpacity={0.25} />
        <motion.circle
          cx={SAT[0]}
          cy={SAT[1]}
          r={6}
          fill={beamColor}
          animate={active && !reduce ? { r: [5, 7, 5] } : { r: 5.5 }}
          transition={active && !reduce ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
        />

        {/* dish: short mast + tilted face */}
        <g className="beam-dish">
          <line x1={DISH[0]} y1={DISH[1] + 8} x2={DISH[0]} y2={DISH[1] - 4} />
          <line x1={DISH[0] - 11} y1={DISH[1] - 2} x2={DISH[0] + 11} y2={DISH[1] - 8} strokeWidth={3.5} strokeLinecap="round" />
        </g>

        <text x={130} y={150} className="beam-wordmark" textAnchor="middle">
          STARLINK
        </text>
      </svg>

      <div className="speed-beam-readout">
        <span className="speed-beam-value">{value === null && eased < 0.1 ? "—" : eased.toFixed(eased < 100 ? 1 : 0)}</span>
        <span className="speed-beam-unit">Mbps</span>
      </div>
      <div className="speed-gauge-caption">{caption}</div>
    </div>
  );
}
