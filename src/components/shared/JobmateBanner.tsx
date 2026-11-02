import { JOBMATE_INK, JobmateGlyph } from "../../assets/icons/JobmateGlyph";
import { JobmateWordmark } from "../../assets/icons/JobmateWordmark";
import { NewBadge } from "../ui/new-badge";

const OUTLINE = "#1a1a1a";
const WAVE_WIDTH = 130;
const WAVE_HEIGHT = 72;

// Innermost first, so each band is painted over by the one outside it.
const STRIPES = [
  { fill: JOBMATE_INK, edge: 106 },
  { fill: "#f39a42", edge: 78 },
  { fill: "#4cc95a", edge: 50 },
  { fill: "#ff7a6b", edge: 22 },
];

function Waves({
  width,
  height,
  className,
}: {
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
      preserveAspectRatio='none'
      aria-hidden='true'
      className={className}
    >
      {STRIPES.map(({ fill, edge }) => (
        <path
          key={fill}
          d={`M-2 -2H${edge}C${edge + 18} 16 ${edge - 16} 44 ${edge + 4} ${WAVE_HEIGHT + 2}H-2Z`}
          fill={fill}
          stroke={OUTLINE}
          strokeWidth={1.5}
          vectorEffect='non-scaling-stroke'
        />
      ))}
    </svg>
  );
}

export function JobmateBanner({
  badge,
  tagline,
  height = WAVE_HEIGHT,
  waveWidth = (WAVE_WIDTH * height) / WAVE_HEIGHT,
  taglineSize = height * 0.16,
}: {
  badge?: string;
  tagline?: string;
  height?: number;
  /** Narrower than the stripes' natural width squeezes them, leaving the middle more room. */
  waveWidth?: number;
  taglineSize?: number;
}) {
  const logo = height * 0.39;
  // The panel stops under the innermost stripe rather than spanning the banner: a
  // light fill beneath the corners bleeds through the rounded clip's antialiasing.
  const panelInset = waveWidth * 0.72;
  return (
    <span className='relative flex items-center justify-center overflow-hidden' style={{ height }}>
      <span
        className='absolute inset-y-0 bg-[#ddd8ff]'
        style={{ left: panelInset, right: panelInset }}
      />
      <Waves width={waveWidth} height={height} className='absolute top-0 left-0' />
      <Waves width={waveWidth} height={height} className='absolute top-0 right-0 -scale-x-100' />
      <span
        className='relative flex flex-col items-center gap-1 text-center'
        style={{ maxWidth: `calc(100% - ${waveWidth * 2}px)` }}
      >
        <span className='flex items-center gap-2.5'>
          <span className='flex items-center' style={{ gap: logo * 0.25 }}>
            <JobmateGlyph style={{ height: logo, width: "auto" }} />
            <JobmateWordmark style={{ height: logo * 0.7, width: "auto" }} />
          </span>
          {badge && <NewBadge className='px-2.5 py-0.5 text-[12.5px]'>{badge}</NewBadge>}
        </span>
        {tagline && (
          <span
            className='leading-tight font-medium'
            style={{ color: JOBMATE_INK, fontSize: taglineSize }}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}
