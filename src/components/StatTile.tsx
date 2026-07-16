// Stat tile in the Starlink app layout: bold title, big number with the
// sparkline running inline to its right, gray caption underneath.

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  sparkValues?: (number | null)[];
  sparkColorVar?: string;
  /** Opens the stat's detail sheet; renders the tile as a button with a chevron. */
  onOpenDetail?: () => void;
}

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 30;
const SPARK_POINTS = 28;

/** Average the raw samples down to a fixed point count so bursty signals (idle
 *  download traffic especially) read as a calm line instead of a full-height
 *  zigzag. Buckets with no finite sample stay null and break the line. */
function bucketAverage(sparkValues: (number | null)[]): (number | null)[] {
  const bucketCount = Math.min(SPARK_POINTS, sparkValues.length);
  if (bucketCount < 2) return sparkValues;
  return Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const start = Math.floor((bucketIndex * sparkValues.length) / bucketCount);
    const end = Math.floor(((bucketIndex + 1) * sparkValues.length) / bucketCount);
    const slice = sparkValues.slice(start, end).filter((value): value is number => value !== null);
    return slice.length === 0 ? null : slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildSparkPath(sparkValues: (number | null)[]): string {
  const points = bucketAverage(sparkValues);
  const finiteValues = points.filter((value): value is number => value !== null);
  if (finiteValues.length < 2) return "";
  const maxValue = Math.max(...finiteValues, 1e-9);
  const stepX = SPARK_WIDTH / (points.length - 1);
  let path = "";
  let pathOpen = false;
  points.forEach((value, pointIndex) => {
    if (value === null) {
      pathOpen = false;
      return;
    }
    const x = pointIndex * stepX;
    const y = SPARK_HEIGHT - 3 - (value / maxValue) * (SPARK_HEIGHT - 6);
    path += `${pathOpen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pathOpen = true;
  });
  return path;
}

export function StatTile({ label, value, unit, caption, sparkValues, sparkColorVar, onOpenDetail }: StatTileProps) {
  const sparkPath = sparkValues ? buildSparkPath(sparkValues) : "";
  const TileElement = onOpenDetail ? "button" : "div";
  return (
    <TileElement
      className={`card stat-tile${onOpenDetail ? " stat-tile-clickable" : ""}`}
      onClick={onOpenDetail}
      type={onOpenDetail ? "button" : undefined}
    >
      <span className="stat-title">
        {label}
        {onOpenDetail && <span className="stat-chevron">›</span>}
      </span>
      <div className="stat-value-row">
        <span className="stat-value">{value}</span>
        {unit && <span className="stat-unit">{unit}</span>}
        {sparkPath && (
          <svg
            className="stat-spark"
            height={SPARK_HEIGHT}
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            preserveAspectRatio="none"
          >
            <path
              d={sparkPath}
              fill="none"
              stroke={`var(${sparkColorVar ?? "--chart-ink"})`}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      {caption && <span className="stat-caption">{caption}</span>}
    </TileElement>
  );
}
