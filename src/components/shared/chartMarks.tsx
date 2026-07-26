// The marks TelemetryChart draws, split out from the chart that positions them.
//
// These are not icons and do not belong in icons/: every one of them is stated
// in the plot's own coordinate space, and means nothing outside it. The chart
// keeps the scales — xForTime, yForValue and the margins — and hands these
// already-resolved pixel positions, so nothing here does arithmetic on a
// timestamp or a reading.

/** The plot rectangle inside the SVG, in pixels. */
export interface PlotFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

const AXIS_TEXT = {
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  fill: "var(--ink-muted)",
} as const;

/** Series colour fading to transparent — the wash under the first series. */
export function WashGradient({ id, colorVar }: { id: string; colorVar: string }) {
  return (
    <linearGradient id={id} x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0%' stopColor={`var(${colorVar})`} stopOpacity={0.28} />
      <stop offset='100%' stopColor={`var(${colorVar})`} stopOpacity={0} />
    </linearGradient>
  );
}

/** Hairline rule and its label, one per y tick. */
export function PlotGrid({
  frame,
  ticks,
}: {
  frame: PlotFrame;
  ticks: readonly { label: string; y: number }[];
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick.label}>
          <line
            x1={frame.left}
            x2={frame.left + frame.width}
            y1={tick.y}
            y2={tick.y}
            stroke='var(--hairline)'
            strokeWidth={1}
          />
          <text x={frame.left - 7} y={tick.y + 3} textAnchor='end' {...AXIS_TEXT}>
            {tick.label}
          </text>
        </g>
      ))}
    </>
  );
}

/** The rule the plot sits on. */
export function PlotBaseline({ frame }: { frame: PlotFrame }) {
  return (
    <line
      x1={frame.left}
      x2={frame.left + frame.width}
      y1={frame.top + frame.height}
      y2={frame.top + frame.height}
      stroke='var(--baseline)'
      strokeWidth={1}
    />
  );
}

/** Clock labels along the bottom. */
export function PlotTimeAxis({
  ticks,
  y,
}: {
  ticks: readonly { label: string; x: number }[];
  y: number;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <text key={tick.label} x={tick.x} y={y} textAnchor='middle' {...AXIS_TEXT}>
          {tick.label}
        </text>
      ))}
    </>
  );
}

/** A vertical band across the full plot height. */
function Band({
  frame,
  x,
  width,
  fill,
  opacity,
}: {
  frame: PlotFrame;
  x: number;
  width: number;
  fill: string;
  opacity: number;
}) {
  return (
    <rect x={x} y={frame.top} width={width} height={frame.height} fill={fill} opacity={opacity} />
  );
}

/** When the link was down. */
export function OutageBands({
  frame,
  bands,
}: {
  frame: PlotFrame;
  bands: readonly { key: string | number; x: number; width: number }[];
}) {
  return (
    <>
      {bands.map((band) => (
        <Band
          key={band.key}
          frame={frame}
          x={band.x}
          width={band.width}
          fill='var(--status-critical)'
          opacity={0.09}
        />
      ))}
    </>
  );
}

/** When nothing was recorded — named, so absence reads as deliberate rather
 *  than as a chart that failed to draw. The label only fits on wider holes. */
export function NoDataBands({
  frame,
  bands,
}: {
  frame: PlotFrame;
  bands: readonly { key: string | number; x: number; width: number }[];
}) {
  return (
    <>
      {bands.map((band) => (
        <g key={band.key}>
          <Band
            frame={frame}
            x={band.x}
            width={band.width}
            fill='var(--ink-muted)'
            opacity={0.06}
          />
          {band.width > 54 && (
            <text
              x={band.x + band.width / 2}
              y={frame.top + frame.height / 2}
              textAnchor='middle'
              {...AXIS_TEXT}
            >
              no data
            </text>
          )}
        </g>
      ))}
    </>
  );
}

/** The wash under the first series. */
export function SeriesArea({ d, gradientId }: { d: string; gradientId: string }) {
  return <path d={d} fill={`url(#${gradientId})`} />;
}

/** One plotted series. */
export function SeriesLine({ d, colorVar }: { d: string; colorVar: string }) {
  return (
    <path
      d={d}
      fill='none'
      stroke={`var(${colorVar})`}
      strokeWidth={2}
      strokeLinejoin='round'
      strokeLinecap='round'
    />
  );
}

/** Hover rule with a dot on each series that has a reading there. */
export function Crosshair({
  frame,
  x,
  points,
}: {
  frame: PlotFrame;
  x: number;
  points: readonly { key: string; y: number; colorVar: string }[];
}) {
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={frame.top}
        y2={frame.top + frame.height}
        stroke='var(--baseline)'
        strokeWidth={1}
      />
      {points.map((point) => (
        <circle
          key={point.key}
          cx={x}
          cy={point.y}
          r={4.5}
          fill={`var(${point.colorVar})`}
          stroke='var(--surface)'
          strokeWidth={2}
        />
      ))}
    </g>
  );
}
