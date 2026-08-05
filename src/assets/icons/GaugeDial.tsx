// The speedometer face: a 270° arc, a tick ring, a needle on a hub, and the
// readout in the middle.
//
// The dial knows angles; the caller knows speeds. Everything here takes a
// fraction of the sweep (0 at the bottom-left, 1 at the bottom-right), so the
// non-linear scale that turns Mbps into those fractions stays with the caller
// and this file never learns what a megabit is.

const CENTER = 130;
const RADIUS = 100;
const START_DEG = 135; // bottom-left
const SWEEP_DEG = 270; // clockwise to bottom-right

/** Where a fraction of the sweep lands, `radius` out from the hub. */
function pointOnArc(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function degFor(fraction: number): number {
  return START_DEG + fraction * SWEEP_DEG;
}

function arcPath(radius: number, fromFraction: number, toFraction: number): string {
  const fromDeg = degFor(fromFraction);
  const toDeg = degFor(toFraction);
  const [x0, y0] = pointOnArc(radius, fromDeg);
  const [x1, y1] = pointOnArc(radius, toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export interface GaugeTick {
  /** Printed beside the tick. */
  label: string;
  /** 0–1 along the sweep. */
  fraction: number;
}

interface GaugeDialProps extends React.ComponentProps<"svg"> {
  /** 0–1 along the sweep: how far the fill runs and where the needle points. */
  fraction: number;
  ticks: readonly GaugeTick[];
  /** Paints the fill arc, needle and hub — the caller's series colour. */
  color: string;
  /** Big number in the middle, already formatted. */
  value: string;
  /** Small caption under it, e.g. "Mbps". */
  unit: string;
  /** Dims the readout while the figure is a resting placeholder. */
  muted?: boolean;
}

export function GaugeDial({
  fraction,
  ticks,
  color,
  value,
  unit,
  muted = false,
  ...props
}: GaugeDialProps) {
  const [needleX, needleY] = pointOnArc(RADIUS - 12, degFor(fraction));

  return (
    <svg viewBox='0 0 260 240' {...props}>
      <path
        d={arcPath(RADIUS, 0, 1)}
        fill='none'
        stroke='var(--hairline)'
        strokeWidth={10}
        strokeLinecap='round'
      />
      {fraction > 0 && (
        <path
          d={arcPath(RADIUS, 0, fraction)}
          fill='none'
          stroke={color}
          strokeWidth={10}
          strokeLinecap='round'
        />
      )}
      {ticks.map((tick) => {
        const deg = degFor(tick.fraction);
        const [ix, iy] = pointOnArc(RADIUS - 18, deg);
        const [ox, oy] = pointOnArc(RADIUS - 8, deg);
        const [lx, ly] = pointOnArc(RADIUS - 32, deg);
        return (
          <g key={tick.label}>
            <line x1={ix} y1={iy} x2={ox} y2={oy} stroke='var(--baseline)' strokeWidth={1.5} />
            <text
              x={lx}
              y={ly}
              className='fill-ink-muted font-mono text-[9px]'
              textAnchor='middle'
              dominantBaseline='middle'
            >
              {tick.label}
            </text>
          </g>
        );
      })}
      <line
        x1={CENTER}
        y1={CENTER}
        x2={needleX}
        y2={needleY}
        stroke={color}
        strokeWidth={3}
        strokeLinecap='round'
      />
      <circle cx={CENTER} cy={CENTER} r={7} fill={color} />
      <text
        x={CENTER}
        y={CENTER + 52}
        className={`text-[40px] font-bold tracking-[-0.02em] ${muted ? "fill-ink-muted" : "fill-ink"}`}
        textAnchor='middle'
      >
        {value}
      </text>
      <text
        x={CENTER}
        y={CENTER + 72}
        className='fill-ink-muted text-[13px] font-medium'
        textAnchor='middle'
      >
        {unit}
      </text>
    </svg>
  );
}
