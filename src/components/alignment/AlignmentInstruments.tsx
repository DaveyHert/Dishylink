// The two dials, ported 1:1 from the dish's own web app:
//  - Rotation = their `xd`: dotted ring (gaps at the cardinals), sector wedge =
//    desired ± tolerance, white dish rect + ORANGE needle both rotated to the
//    ACTUAL azimuth
//  - Tilt     = their `Ad`: y-flipped quarter arc, wedge spanning the valid
//    elevation band, dish plate + orange needle at the ACTUAL elevation
// Their needle orange is #ffac30. Size ratios are verbatim from their code.

import { type AlignmentReading } from "./alignmentMath";
import {
  CompassLabels,
  DialDots,
  DishPointer,
  ToleranceWedge,
} from "../../assets/icons/AlignmentDial";

const SIZE = 250;

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
      <span className='size-[7px] flex-none rounded-full' style={{ background: berryColor }} />
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

  // their tick loop: 72 five-degree dots, skipping three around each cardinal.
  // Compass north is up, so the whole ring sits a quarter turn back from the
  // +x axis the marks are drawn against.
  const ringDots: number[] = [];
  for (let dotIndex = 0; dotIndex < 72; dotIndex++) {
    const positionInQuadrant = dotIndex % 18;
    if (positionInQuadrant !== 0 && positionInQuadrant !== 1 && positionInQuadrant !== 17) {
      ringDots.push(dotIndex * 5 - 90);
    }
  }

  return (
    <InstrumentFrame label='Rotation' berry={berryFor(reading.isAligned, reading.isValid)}>
      <DialDots cx={center} cy={center} radius={ringRadius} anglesDeg={ringDots} />
      <CompassLabels cx={center} cy={center} radius={ringRadius} fontSize={SIZE / 20} />
      {/* wedge: desired azimuth ± tolerance (their thetaCenter = desired − 90) */}
      {reading.isValid && (
        <ToleranceWedge
          cx={center}
          cy={center}
          radius={0.98 * ringRadius}
          centerDeg={reading.desiredAzimuthDeg - 90}
          spanDeg={2 * reading.azimuthToleranceDeg}
          inSpec={reading.isAligned}
        />
      )}
      {/* dish rect + orange needle, both at the ACTUAL azimuth */}
      <DishPointer
        cx={center}
        cy={center}
        rotateDeg={needleAzimuth}
        width={dishWidth}
        height={dishHeight}
        needleY2={reading.isValid ? center - 0.94 * ringRadius : undefined}
      />
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
        <DialDots cx={pivot} cy={pivot} radius={arcRadius} anglesDeg={arcDots} />
        {/* wedge spanning the valid elevation band */}
        {reading.isValid && (
          <ToleranceWedge
            cx={pivot}
            cy={pivot}
            radius={0.98 * arcRadius}
            centerDeg={(reading.upperElevationLimitDeg + reading.lowerElevationLimitDeg) / 2}
            spanDeg={reading.upperElevationLimitDeg - reading.lowerElevationLimitDeg}
            inSpec={reading.isElevationValid}
          />
        )}
        {/* dish plate + orange needle at the ACTUAL elevation */}
        <DishPointer
          cx={pivot}
          cy={pivot}
          rotateDeg={needleElevation - 90}
          width={dishLength}
          height={dishThickness}
          needleY2={reading.isValid ? pivot + 0.96 * arcRadius : undefined}
        />
      </g>
    </InstrumentFrame>
  );
}
