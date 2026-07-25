// The obstruction dome as a plain canopy — the simple umbrella mark with its
// handle cut away, leaving only the dome shell. Marks the control that shows or
// hides the whole dome over the sky.
//
// The viewBox is cropped to the canopy's bounds (with room for the strike) so the
// dome fills the control rather than floating in a tall square. `off` reflects the
// live state: the dome dims and a slash strikes through it once it is hidden.

const DOME =
  "M240,126.63A112.44,112.44,0,0,0,51.75,53.75a111.56,111.56,0,0,0-35.7,72.88A16,16,0,0,0,32,144h192a16,16,0,0,0,16-17.37Z" +
  "M32,128l0,0A96.43,96.43,0,0,1,193.4,65.52,95.32,95.32,0,0,1,224,128Z";

// The canopy is close to a full semicircle: its arc peaks near y24, so the box
// has to reach up there or the roof clips flat. x16–240, y24–144, plus a margin.
const VIEW = { x: 8, y: 18, w: 240, h: 134 };

// The strike's ends are round caps, so each reaches half the stroke width past
// its point — the box has to hold that too, or the lower end is cut flat.
const STRIKE = { x1: 44, y1: 140, x2: 212, y2: 36, width: 20 };

export function DomeCanopyIcon({
  size = 20,
  off = false,
  ...props
}: React.ComponentProps<"svg"> & { size?: number; off?: boolean }) {
  return (
    <svg
      width={size}
      height={(size * VIEW.h) / VIEW.w}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      fill='currentColor'
      aria-hidden='true'
      {...props}
    >
      <path d={DOME} opacity={off ? 0.4 : 1} />
      {off && (
        <line
          x1={STRIKE.x1}
          y1={STRIKE.y1}
          x2={STRIKE.x2}
          y2={STRIKE.y2}
          fill='none'
          stroke='currentColor'
          strokeWidth={STRIKE.width}
          strokeLinecap='round'
        />
      )}
    </svg>
  );
}
