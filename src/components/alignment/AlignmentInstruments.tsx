// The two dials, ported 1:1 from the dish's own web app:
//  - Rotation = their `xd`: dotted ring (gaps at the cardinals), sector wedge =
//    desired ± tolerance, white dish rect + ORANGE needle both rotated to the
//    ACTUAL azimuth
//  - Tilt     = their `Ad`: y-flipped quarter arc, wedge spanning the valid
//    elevation band, dish plate + orange needle at the ACTUAL elevation
// Their needle orange is #ffac30. Size ratios are verbatim from their code.

import { DEG_TO_RAD, type AlignmentReading } from "./alignmentMath";

const NEEDLE_ORANGE = "#ffac30";
const SIZE = 250;

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

/** Instrument title with its health berry. */
function InstrumentHead({ label, berry }: { label: string; berry: "good" | "bad" | "unknown" }) {
  const berryColor =
    berry === "good"
      ? "var(--status-good)"
      : berry === "bad"
        ? "var(--status-critical)"
        : "var(--ink-muted)";
  return (
    <div className='mb-1 flex items-center gap-[7px]'>
      <span className='font-mono text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground uppercase'>
        {label}
      </span>
      <span className='status-dot' style={{ background: berryColor }} />
    </div>
  );
}

/** Card shell both dials sit in. */
function InstrumentFrame({
  label,
  berry,
  children,
}: {
  label: string;
  berry: "good" | "bad" | "unknown";
  children: React.ReactNode;
}) {
  return (
    <div className='min-w-0 flex-1 rounded-lg bg-[color-mix(in_srgb,var(--ink)_3%,var(--surface))] px-3.5 pt-3 pb-1.5'>
      <InstrumentHead label={label} berry={berry} />
      <svg width='100%' viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {children}
      </svg>
    </div>
  );
}

/** Health berry for a dial: green when in spec, red when out, grey until the
 *  attitude filter has anything to say. */
function berryFor(inSpec: boolean, isValid: boolean): "good" | "bad" | "unknown" {
  return inSpec ? "good" : isValid ? "bad" : "unknown";
}

export function RotationInstrument({ reading }: { reading: AlignmentReading }) {
  const center = SIZE / 2;
  const ringRadius = 0.45 * SIZE;
  const dishWidth = SIZE / 8;
  const dishHeight = SIZE / 6;
  const needleAzimuth = reading.isValid ? reading.boresightAzimuthDeg : 0;

  // their tick loop: 72 five-degree dots, skipping three around each cardinal
  const ringDots: number[] = [];
  for (let dotIndex = 0; dotIndex < 72; dotIndex++) {
    const positionInQuadrant = dotIndex % 18;
    if (positionInQuadrant !== 0 && positionInQuadrant !== 1 && positionInQuadrant !== 17) {
      ringDots.push(dotIndex * 5);
    }
  }
  const compassLabels = [
    { label: "N", angleDeg: 0 },
    { label: "E", angleDeg: 90 },
    { label: "S", angleDeg: 180 },
    { label: "W", angleDeg: 270 },
  ];

  return (
    <InstrumentFrame label='Rotation' berry={berryFor(reading.isAligned, reading.isValid)}>
      {ringDots.map((angleDeg) => {
        const angleRad = (angleDeg - 90) * DEG_TO_RAD;
        return (
          <circle
            key={angleDeg}
            cx={center + ringRadius * Math.cos(angleRad)}
            cy={center + ringRadius * Math.sin(angleRad)}
            r={1.2}
            fill='var(--ink-secondary)'
          />
        );
      })}
      {compassLabels.map((mark) => {
        const angleRad = (mark.angleDeg - 90) * DEG_TO_RAD;
        return (
          <text
            key={mark.label}
            x={center + ringRadius * Math.cos(angleRad)}
            y={center + ringRadius * Math.sin(angleRad)}
            dy='0.35em'
            textAnchor='middle'
            fontSize={SIZE / 20}
            fontWeight={600}
            fill='var(--ink-secondary)'
            fontFamily='var(--font-ui)'
          >
            {mark.label}
          </text>
        );
      })}
      {/* wedge: desired azimuth ± tolerance (their thetaCenter = desired − 90) */}
      {reading.isValid && (
        <path
          d={sectorPath(
            center,
            center,
            0.98 * ringRadius,
            reading.desiredAzimuthDeg - 90,
            2 * reading.azimuthToleranceDeg,
          )}
          fill='var(--ink-muted)'
          opacity={reading.isAligned ? 0.32 : 0.16}
        />
      )}
      {/* dish rect + orange needle, both at the ACTUAL azimuth */}
      <g transform={`rotate(${needleAzimuth} ${center} ${center})`}>
        <rect
          x={center - dishWidth / 2}
          y={center - dishHeight / 2}
          width={dishWidth}
          height={dishHeight}
          rx={1}
          fill='var(--dish-body)'
          stroke='var(--dish-edge)'
          strokeWidth={0.75}
        />
        {reading.isValid && (
          <line
            x1={center}
            y1={center}
            x2={center}
            y2={center - 0.94 * ringRadius}
            stroke={NEEDLE_ORANGE}
            strokeWidth={1.5}
            strokeLinecap='round'
          />
        )}
      </g>
    </InstrumentFrame>
  );
}

export function TiltInstrument({ reading }: { reading: AlignmentReading }) {
  const pivot = SIZE / 6;
  const arcRadius = 0.77 * SIZE;
  const dishLength = SIZE / 4;
  const dishThickness = dishLength / 10;
  const needleElevation = reading.isValid ? reading.boresightElevationDeg : 70;

  const arcDots: number[] = [];
  for (let dotIndex = 0; dotIndex < 19; dotIndex++) arcDots.push(dotIndex * 5);

  return (
    <InstrumentFrame label='Tilt' berry={berryFor(reading.isElevationValid, reading.isValid)}>
      {/* their y-up coordinate system: translate(0, size) scale(1, -1) */}
      <g transform={`translate(0, ${SIZE}) scale(1, -1)`}>
        {arcDots.map((angleDeg) => {
          const angleRad = angleDeg * DEG_TO_RAD;
          return (
            <circle
              key={angleDeg}
              cx={pivot + arcRadius * Math.cos(angleRad)}
              cy={pivot + arcRadius * Math.sin(angleRad)}
              r={1.2}
              fill='var(--ink-secondary)'
            />
          );
        })}
        {/* wedge spanning the valid elevation band */}
        {reading.isValid && (
          <path
            d={sectorPath(
              pivot,
              pivot,
              0.98 * arcRadius,
              (reading.upperElevationLimitDeg + reading.lowerElevationLimitDeg) / 2,
              reading.upperElevationLimitDeg - reading.lowerElevationLimitDeg,
            )}
            fill='var(--ink-muted)'
            opacity={reading.isElevationValid ? 0.32 : 0.16}
          />
        )}
        {/* dish plate + orange needle at the ACTUAL elevation */}
        <g transform={`rotate(${needleElevation - 90} ${pivot} ${pivot})`}>
          <rect
            x={pivot - dishLength / 2}
            y={pivot - dishThickness / 2}
            width={dishLength}
            height={dishThickness}
            rx={1}
            fill='var(--dish-body)'
            stroke='var(--dish-edge)'
            strokeWidth={0.75}
          />
          {reading.isValid && (
            <line
              x1={pivot}
              y1={pivot}
              x2={pivot}
              y2={pivot + 0.96 * arcRadius}
              stroke={NEEDLE_ORANGE}
              strokeWidth={1.5}
              strokeLinecap='round'
            />
          )}
        </g>
      </g>
    </InstrumentFrame>
  );
}
