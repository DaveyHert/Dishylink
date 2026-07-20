// Starlink-app-style speed visualization: a dish on a ring "horizon" firing a
// beam up to a satellite on its orbit arc. An alternative to the gauge — same
// { value, mode, caption } contract. During a test the beam pulses and a packet
// travels along it (down = satellite→dish, up = dish→satellite); the big value
// eases like the gauge. Theme-aware via CSS variables.
//
// `running` (test in flight) is deliberately separate from `mode`: when a test
// finishes the parent keeps mode="download" to hold the final reading, so the
// motion loops must key off `running` or they'd never stop.

import { motion, useReducedMotion } from "motion/react";
import { useEasedValue } from "../../hooks/useEasedValue";
import { SpeedCaption } from "./SpeedCaption";

interface SpeedBeamProps {
  value: number | null;
  mode: "download" | "upload" | "idle";
  caption: string;
  running?: boolean;
}

const DISH: [number, number] = [130, 168];
const SAT: [number, number] = [201, 55];
const RING_RADII = [26, 50, 76, 104, 134];
// Slow, shallow breathing — the Starlink app's beam swells rather than blinks.
// Kept longer than the packet transit so the two rhythms don't lock in step.
const PULSE_SECONDS = 3.2;
const PACKET_SECONDS = 1.5;

export function SpeedBeam({ value, mode, caption, running = false }: SpeedBeamProps) {
  const reduce = useReducedMotion() ?? false;
  const eased = useEasedValue(value ?? 0);
  const active = mode !== "idle";
  const animating = running && !reduce;
  const pending = value === null && eased < 0.1;
  // One colour in both directions — the packet's direction of travel already says
  // which phase is running, so recolouring the whole beam only made the view flicker
  // between two looks mid-test.
  const beamColor = "var(--chart-ink)";
  // Packet direction: download flows down to the dish, upload flows up.
  const from = mode === "upload" ? DISH : SAT;
  const to = mode === "upload" ? SAT : DISH;

  return (
    <div className="speed-beam">
      <svg viewBox="0 0 260 200" className="speed-beam-svg" role="img" aria-label={`${caption} ${value?.toFixed(1) ?? "—"} Mbps`}>
        <defs>
          {/* bloom around the beam and satellite, as in the Starlink app */}
          <filter id="beam-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="bloom" />
            <feMerge>
              <feMergeNode in="bloom" />
              <feMergeNode in="bloom" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="beam-sat-halo">
            <stop offset="0%" stopColor={beamColor} stopOpacity="0.45" />
            <stop offset="35%" stopColor={beamColor} stopOpacity="0.1" />
            <stop offset="100%" stopColor={beamColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ground rings (horizon) */}
        {RING_RADII.map((rx, index) => (
          <ellipse key={index} cx={DISH[0]} cy={DISH[1] + 6} rx={rx} ry={rx * 0.24} className="beam-ring" fill="none" />
        ))}

        {/* orbit arc — rides clear above the satellite so it never crosses the beam */}
        <path d="M18,52 Q130,-6 242,52" className="beam-orbit" fill="none" />

        {/* soft halo behind the satellite — kept out of the blur group so it stays smooth */}
        <circle cx={SAT[0]} cy={SAT[1]} r={15} className="beam-sat-halo" fill="url(#beam-sat-halo)" />

        <g className="beam-glow-layer">
          {/* beam */}
          <motion.line
            x1={DISH[0]}
            y1={DISH[1]}
            x2={SAT[0]}
            y2={SAT[1]}
            stroke={beamColor}
            strokeLinecap="round"
            animate={
              animating ? { opacity: [0.55, 1, 0.55], strokeWidth: [1.8, 2.8, 1.8] } : { opacity: active ? 0.85 : 0.28, strokeWidth: 2 }
            }
            transition={animating ? { duration: PULSE_SECONDS, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
          />

          {/* travelling packet */}
          {animating && (
            <motion.circle
              r={3.5}
              fill={beamColor}
              initial={false}
              animate={{
                cx: [from[0], to[0]],
                cy: [from[1], to[1]],
                opacity: [0, 1, 0],
              }}
              transition={{ duration: PACKET_SECONDS, repeat: Infinity, ease: "linear" }}
            />
          )}

          {/* satellite — initial={false} or motion writes r="undefined" on the first frame */}
          <motion.circle
            cx={SAT[0]}
            cy={SAT[1]}
            r={6}
            fill={beamColor}
            initial={false}
            animate={animating ? { r: [5.2, 6.6, 5.2] } : { r: 5.5 }}
            transition={animating ? { duration: PULSE_SECONDS, repeat: Infinity, ease: "easeInOut" } : {}}
          />
        </g>

        {/* dish: short mast + tilted face */}
        <g className="beam-dish">
          <line x1={DISH[0]} y1={DISH[1] + 8} x2={DISH[0]} y2={DISH[1] - 4} />
          <line x1={DISH[0] - 11} y1={DISH[1] - 8} x2={DISH[0] + 11} y2={DISH[1] - 2} strokeWidth={3.5} strokeLinecap="round" />
        </g>

        {/* wordmark sits in the clear band left of the beam, below the arc, above the rings */}
        <text x={78} y={112} className="beam-wordmark" textAnchor="middle">
          STARLINK
        </text>
      </svg>

      <div className="speed-beam-readout">
        {/* One decimal at every magnitude, so this agrees with the headline figure
            above it — dropping it past 100 made a 118.5 Mbps run read as two
            different numbers on the same screen. */}
        <span className={`speed-beam-value${pending ? " pending" : ""}`}>{pending ? "0" : eased.toFixed(1)}</span>
        <span className="speed-beam-unit">Mbps</span>
      </div>
      <SpeedCaption mode={mode} caption={caption} />
    </div>
  );
}
