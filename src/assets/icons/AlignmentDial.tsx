// The parts both alignment dials are built from — dotted ring, cardinal
// letters, tolerance wedge, and the dish plate carrying its needle.
//
// Rotation and Tilt draw the same four marks at different radii, and Tilt draws
// them inside a y-flipped group. Angles therefore arrive already resolved to SVG
// degrees from the +x axis: the caller applies whatever offset its coordinate
// system needs, and nothing here has to know which dial it is drawing for.

import { DEG_TO_RAD } from "../../components/alignment/alignmentMath";

/** Their needle orange, verbatim from the dish's own web app. */
const NEEDLE_ORANGE = "#ffac30";

interface RingProps {
  cx: number;
  cy: number;
  radius: number;
}

/** The dotted scale ring. */
export function DialDots({
  cx,
  cy,
  radius,
  anglesDeg,
}: RingProps & { anglesDeg: readonly number[] }) {
  return (
    <>
      {anglesDeg.map((angleDeg) => {
        const angleRad = angleDeg * DEG_TO_RAD;
        return (
          <circle
            key={angleDeg}
            cx={cx + radius * Math.cos(angleRad)}
            cy={cy + radius * Math.sin(angleRad)}
            r={1.2}
            fill='var(--ink-secondary)'
          />
        );
      })}
    </>
  );
}

/** N/E/S/W set into the gaps the dot ring leaves at the cardinals. */
export function CompassLabels({ cx, cy, radius, fontSize }: RingProps & { fontSize: number }) {
  const marks = [
    { label: "N", angleDeg: -90 },
    { label: "E", angleDeg: 0 },
    { label: "S", angleDeg: 90 },
    { label: "W", angleDeg: 180 },
  ];
  return (
    <>
      {marks.map((mark) => {
        const angleRad = mark.angleDeg * DEG_TO_RAD;
        return (
          <text
            key={mark.label}
            x={cx + radius * Math.cos(angleRad)}
            y={cy + radius * Math.sin(angleRad)}
            dy='0.35em'
            textAnchor='middle'
            fontSize={fontSize}
            fontWeight={600}
            fill='var(--ink-secondary)'
            fontFamily='var(--font-ui)'
          >
            {mark.label}
          </text>
        );
      })}
    </>
  );
}

/** Filled sector (pie slice), angles in SVG degrees from the +x axis. Their `Id`. */
function sectorPath(
  centerX: number,
  centerY: number,
  radius: number,
  thetaCenterDeg: number,
  thetaDeg: number,
): string {
  const startRad = (thetaCenterDeg - thetaDeg / 2) * DEG_TO_RAD;
  const endRad = (thetaCenterDeg + thetaDeg / 2) * DEG_TO_RAD;
  const largeArc = thetaDeg > 180 ? 1 : 0;
  const startX = centerX + radius * Math.cos(startRad);
  const startY = centerY + radius * Math.sin(startRad);
  const endX = centerX + radius * Math.cos(endRad);
  const endY = centerY + radius * Math.sin(endRad);
  return `M${centerX},${centerY} L${startX.toFixed(2)},${startY.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${endX.toFixed(2)},${endY.toFixed(2)} Z`;
}

/** The band the reading is allowed to sit in — brighter once it does. */
export function ToleranceWedge({
  cx,
  cy,
  radius,
  centerDeg,
  spanDeg,
  inSpec,
}: RingProps & { centerDeg: number; spanDeg: number; inSpec: boolean }) {
  return (
    <path
      d={sectorPath(cx, cy, radius, centerDeg, spanDeg)}
      fill='var(--ink-muted)'
      opacity={inSpec ? 0.32 : 0.16}
    />
  );
}

interface DishPointerProps {
  /** Pivot the plate turns about. */
  cx: number;
  cy: number;
  rotateDeg: number;
  width: number;
  height: number;
  /** Needle tip, in the group's own coordinates. Omit to draw the plate alone. */
  needleY2?: number;
}

/** White dish plate with the orange needle, both turned to the live reading. */
export function DishPointer({ cx, cy, rotateDeg, width, height, needleY2 }: DishPointerProps) {
  return (
    <g transform={`rotate(${rotateDeg} ${cx} ${cy})`}>
      <rect
        x={cx - width / 2}
        y={cy - height / 2}
        width={width}
        height={height}
        rx={1}
        fill='var(--dish-body)'
        stroke='var(--dish-edge)'
        strokeWidth={0.75}
      />
      {needleY2 !== undefined && (
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={needleY2}
          stroke={NEEDLE_ORANGE}
          strokeWidth={1.5}
          strokeLinecap='round'
        />
      )}
    </g>
  );
}
