// Ookla-style circular speed gauge: a 270° arc with a sweeping needle, a
// non-linear (sqrt) scale so low speeds still move the needle, and the live
// value in the center. Theme-aware via CSS variables.

const CENTER = 130;
const RADIUS = 100;
const START_DEG = 135; // bottom-left
const SWEEP_DEG = 270; // clockwise to bottom-right
const MAX_MBPS = 500;
const TICKS = [0, 10, 25, 50, 100, 200, 350, 500];

/** Non-linear position 0..1 for a speed (sqrt spreads out the low end). */
function fractionFor(mbps: number): number {
  const clamped = Math.max(0, Math.min(mbps, MAX_MBPS));
  return Math.sqrt(clamped) / Math.sqrt(MAX_MBPS);
}

function pointOnArc(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function arcPath(radius: number, fromFraction: number, toFraction: number): string {
  const fromDeg = START_DEG + fromFraction * SWEEP_DEG;
  const toDeg = START_DEG + toFraction * SWEEP_DEG;
  const [x0, y0] = pointOnArc(radius, fromDeg);
  const [x1, y1] = pointOnArc(radius, toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

interface SpeedGaugeProps {
  /** Current value the needle points to, in Mbps. */
  value: number | null;
  /** "download" | "upload" tints the fill; anything else is neutral. */
  mode: "download" | "upload" | "idle";
  /** Caption under the big number, e.g. "Download". */
  caption: string;
}

export function SpeedGauge({ value, mode, caption }: SpeedGaugeProps) {
  const fraction = value === null ? 0 : fractionFor(value);
  const needleDeg = START_DEG + fraction * SWEEP_DEG;
  const [needleX, needleY] = pointOnArc(RADIUS - 12, needleDeg);
  const fillColor = mode === "upload" ? "var(--chart-warm)" : "var(--chart-ink)";

  return (
    <div className="speed-gauge">
      <svg viewBox="0 0 260 240" className="speed-gauge-svg" role="img" aria-label={`${caption} ${value?.toFixed(0) ?? "—"} Mbps`}>
        {/* track */}
        <path d={arcPath(RADIUS, 0, 1)} className="gauge-track" fill="none" strokeLinecap="round" />
        {/* fill up to the needle */}
        {fraction > 0 && (
          <path
            d={arcPath(RADIUS, 0, fraction)}
            fill="none"
            stroke={fillColor}
            strokeWidth={10}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.2s ease" }}
          />
        )}
        {/* ticks + labels */}
        {TICKS.map((tick) => {
          const deg = START_DEG + fractionFor(tick) * SWEEP_DEG;
          const [ix, iy] = pointOnArc(RADIUS - 18, deg);
          const [ox, oy] = pointOnArc(RADIUS - 8, deg);
          const [lx, ly] = pointOnArc(RADIUS - 32, deg);
          return (
            <g key={tick}>
              <line x1={ix} y1={iy} x2={ox} y2={oy} className="gauge-tick" />
              <text x={lx} y={ly} className="gauge-tick-label" textAnchor="middle" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          );
        })}
        {/* needle */}
        <line x1={CENTER} y1={CENTER} x2={needleX} y2={needleY} stroke={fillColor} className="gauge-needle" style={{ transition: "all 0.2s ease" }} />
        <circle cx={CENTER} cy={CENTER} r={7} fill={fillColor} />
        {/* center readout */}
        <text x={CENTER} y={CENTER + 52} className="gauge-value" textAnchor="middle">
          {value === null ? "—" : value.toFixed(value < 100 ? 1 : 0)}
        </text>
        <text x={CENTER} y={CENTER + 72} className="gauge-unit" textAnchor="middle">
          Mbps
        </text>
      </svg>
      <div className="speed-gauge-caption">{caption}</div>
    </div>
  );
}
