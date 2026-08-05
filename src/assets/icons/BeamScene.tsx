// The still parts of the Starlink beam view: the ground the dish stands on, the
// track the satellites ride, and the wordmark.
//
// Everything here is drawn once from constants the caller supplies. The moving
// parts — the beam, the packet, the satellites — stay in SpeedBeam, where a rAF
// loop writes their endpoints every frame. These three are split rather than
// grouped because the scene is layered around them: the rings and arc sit under
// the beam, the wordmark over the dish.

interface BeamGroundProps extends React.ComponentProps<"g"> {
  /** Where the dish meets the ground; the rings are centred on it. */
  center: readonly [number, number];
  /** Horizontal radii, innermost first. Each ring is flattened to 0.24 for perspective. */
  radii: readonly number[];
}

/** Concentric ellipses receding to the horizon. */
export function BeamGround({ center, radii, ...props }: BeamGroundProps) {
  return (
    <g {...props}>
      {radii.map((rx) => (
        <ellipse
          key={rx}
          cx={center[0]}
          cy={center[1]}
          rx={rx}
          ry={rx * 0.24}
          fill='none'
          stroke='var(--hairline)'
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/** The satellites' track, a dashed arc riding clear above them. */
export function BeamOrbit({ d, ...props }: React.ComponentProps<"path"> & { d: string }) {
  return (
    <path
      d={d}
      fill='none'
      stroke='var(--baseline)'
      strokeWidth={1}
      strokeDasharray='3 5'
      {...props}
    />
  );
}

/** STARLINK, set wide in the clear band left of the beam. */
export function BeamWordmark(props: React.ComponentProps<"text">) {
  return (
    <text
      className='fill-ink font-sans text-[12px] font-bold tracking-[0.22em]'
      textAnchor='middle'
      {...props}
    >
      STARLINK
    </text>
  );
}
