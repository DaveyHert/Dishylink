// The inline trend line that runs beside a stat's big number.
//
// It stretches to whatever width it is given (preserveAspectRatio="none") and
// keeps its stroke crisp through that stretch with vectorEffect, so the tile can
// size it without the line going wedge-shaped.

const WIDTH = 120;
const HEIGHT = 30;
const POINTS = 28;

/** Average the raw samples down to a fixed point count so bursty signals (idle
 *  download traffic especially) read as a calm line instead of a full-height
 *  zigzag. Buckets with no finite sample stay null and break the line. */
function bucketAverage(values: (number | null)[]): (number | null)[] {
  const bucketCount = Math.min(POINTS, values.length);
  if (bucketCount < 2) return values;
  return Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const start = Math.floor((bucketIndex * values.length) / bucketCount);
    const end = Math.floor(((bucketIndex + 1) * values.length) / bucketCount);
    const slice = values.slice(start, end).filter((value): value is number => value !== null);
    return slice.length === 0 ? null : slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildPath(values: (number | null)[]): string {
  const points = bucketAverage(values);
  const finiteValues = points.filter((value): value is number => value !== null);
  if (finiteValues.length < 2) return "";
  const maxValue = Math.max(...finiteValues, 1e-9);
  const stepX = WIDTH / (points.length - 1);
  let path = "";
  let pathOpen = false;
  points.forEach((value, pointIndex) => {
    if (value === null) {
      pathOpen = false;
      return;
    }
    const x = pointIndex * stepX;
    const y = HEIGHT - 3 - (value / maxValue) * (HEIGHT - 6);
    path += `${pathOpen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pathOpen = true;
  });
  return path;
}

// `values` is also an SVG animation attribute (a string), so it is dropped from
// the passthrough props rather than fought with.
interface SparklineProps extends Omit<React.ComponentProps<"svg">, "values"> {
  values: (number | null)[];
  /** CSS custom property naming the stroke, e.g. "--series-down". */
  colorVar?: string;
}

/** Renders nothing when there are too few samples to make a line. */
export function Sparkline({ values, colorVar = "--chart-ink", ...props }: SparklineProps) {
  const path = buildPath(values);
  if (!path) return null;

  return (
    <svg height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio='none' {...props}>
      <path
        d={path}
        fill='none'
        stroke={`var(${colorVar})`}
        strokeWidth={1.5}
        strokeLinejoin='round'
        strokeLinecap='round'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  );
}
