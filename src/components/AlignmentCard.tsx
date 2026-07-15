// Alignment sheet modeled on the dish's own debug instruments: a Rotation
// compass (dotted ring, dish glyph at actual azimuth, orange needle at the
// desired azimuth with a tolerance wedge) and a Tilt quadrant (dotted arc,
// dish drawn at its actual tilt, orange needle at the desired elevation).
// Rendered inside a wide SheetModal.

import type { DishStatusJson, DishAlignmentStatsJson } from "../lib/dishClient";

const ALIGNED_TOLERANCE_DEG = 2;
const WEDGE_HALF_WIDTH_DEG = 9;
// Real alignment errors are fractions of a degree — invisible at 1:1 scale.
// Like a course-deviation instrument, the *error* is drawn magnified (and
// labeled as such); the wedge marks the aligned tolerance at the same scale.
const ERROR_MAGNIFICATION = 8;
const ERROR_DISPLAY_CLAMP_DEG = 24;

function magnifiedError(actualDeg: number, desiredDeg: number): number {
  const magnified = (actualDeg - desiredDeg) * ERROR_MAGNIFICATION;
  return Math.max(-ERROR_DISPLAY_CLAMP_DEG, Math.min(ERROR_DISPLAY_CLAMP_DEG, magnified));
}

export function alignmentVerdict(status: DishStatusJson | null): "aligned" | "adjust dish" | "—" {
  const alignment = status?.alignmentStats;
  if (!alignment) return "—";
  const azimuthError = Math.abs((alignment.boresightAzimuthDeg ?? 0) - (alignment.desiredBoresightAzimuthDeg ?? 0));
  const elevationError = Math.abs(
    (alignment.boresightElevationDeg ?? 0) - (alignment.desiredBoresightElevationDeg ?? 0),
  );
  return azimuthError < ALIGNED_TOLERANCE_DEG && elevationError < ALIGNED_TOLERANCE_DEG ? "aligned" : "adjust dish";
}

function polar(centerX: number, centerY: number, angleFromNorthDeg: number, radius: number) {
  const angleRad = (angleFromNorthDeg * Math.PI) / 180;
  return { x: centerX + Math.sin(angleRad) * radius, y: centerY - Math.cos(angleRad) * radius };
}

function wedgePath(centerX: number, centerY: number, centerAngleDeg: number, radius: number): string {
  const from = polar(centerX, centerY, centerAngleDeg - WEDGE_HALF_WIDTH_DEG, radius);
  const to = polar(centerX, centerY, centerAngleDeg + WEDGE_HALF_WIDTH_DEG, radius);
  return `M${centerX},${centerY} L${from.x.toFixed(1)},${from.y.toFixed(1)} A${radius},${radius} 0 0 1 ${to.x.toFixed(1)},${to.y.toFixed(1)} Z`;
}

function InstrumentHead({ label, isGood }: { label: string; isGood: boolean }) {
  return (
    <div className="instrument-head">
      <span className="micro-label">{label}</span>
      <span
        className="status-dot"
        style={{ background: isGood ? "var(--status-good)" : "var(--chart-warm)" }}
      />
    </div>
  );
}

function RotationInstrument({ alignment }: { alignment: DishAlignmentStatsJson }) {
  const size = 250;
  const center = size / 2;
  const ringRadius = center - 26;
  const actualAzimuth = alignment.boresightAzimuthDeg ?? 0;
  const desiredAzimuth = alignment.desiredBoresightAzimuthDeg ?? 0;
  const isGood = Math.abs(actualAzimuth - desiredAzimuth) < ALIGNED_TOLERANCE_DEG;
  // dish drawn at desired + magnified error, so a 1.7° offset is visible
  const displayedDishAzimuth = desiredAzimuth + magnifiedError(actualAzimuth, desiredAzimuth);

  const compassLabels = [
    { label: "N", angle: 0 },
    { label: "E", angle: 90 },
    { label: "S", angle: 180 },
    { label: "W", angle: 270 },
  ];

  return (
    <div className="instrument-panel">
      <InstrumentHead label="Rotation" isGood={isGood} />
      <svg width="100%" viewBox={`0 0 ${size} ${size - 14}`}>
        <g transform="translate(0,-6)">
          <circle
            cx={center}
            cy={center}
            r={ringRadius}
            fill="none"
            stroke="var(--ink-muted)"
            strokeWidth={1.6}
            strokeDasharray="0.5 5.5"
            strokeLinecap="round"
            opacity={0.8}
          />
          {compassLabels.map((mark) => {
            const labelPoint = polar(center, center, mark.angle, ringRadius + 14);
            return (
              <text
                key={mark.label}
                x={labelPoint.x}
                y={labelPoint.y + 3}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--ink-secondary)"
                fontFamily="var(--font-ui)"
              >
                {mark.label}
              </text>
            );
          })}
          {/* tolerance wedge around the desired azimuth */}
          <path d={wedgePath(center, center, desiredAzimuth, ringRadius - 4)} fill="var(--ink-muted)" opacity={0.22} />
          {/* desired azimuth needle */}
          <line
            x1={center}
            y1={center}
            x2={polar(center, center, desiredAzimuth, ringRadius - 4).x}
            y2={polar(center, center, desiredAzimuth, ringRadius - 4).y}
            stroke="var(--chart-warm)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* actual boresight needle (magnified error) */}
          <line
            x1={center}
            y1={center}
            x2={polar(center, center, displayedDishAzimuth, ringRadius - 24).x}
            y2={polar(center, center, displayedDishAzimuth, ringRadius - 24).y}
            stroke="var(--chart-ink)"
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.85}
          />
          {/* the dish, seen from above, at the magnified actual azimuth */}
          <g transform={`rotate(${displayedDishAzimuth} ${center} ${center})`}>
            <rect
              x={center - 11}
              y={center - 15}
              width={22}
              height={30}
              rx={2.5}
              fill="var(--chart-ink)"
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

function TiltInstrument({ alignment }: { alignment: DishAlignmentStatsJson }) {
  const width = 250;
  const height = 220;
  const pivotX = 62;
  const pivotY = height - 44;
  const armLength = 132;
  const actualElevation = alignment.boresightElevationDeg ?? 0;
  const desiredElevation = alignment.desiredBoresightElevationDeg ?? 0;
  const isGood = Math.abs(actualElevation - desiredElevation) < ALIGNED_TOLERANCE_DEG;
  const displayedElevation = desiredElevation + magnifiedError(actualElevation, desiredElevation);

  // elevation measured from the horizon; drawn in the up-right quadrant
  const pointAt = (elevationDeg: number, radius: number) => ({
    x: pivotX + Math.cos((elevationDeg * Math.PI) / 180) * radius,
    y: pivotY - Math.sin((elevationDeg * Math.PI) / 180) * radius,
  });

  const arcDots = Array.from({ length: 25 }, (_, dotIndex) => 25 + dotIndex * 2.9); // 25°..95°
  const desiredPoint = pointAt(desiredElevation, armLength);
  const wedgeFrom = pointAt(desiredElevation + WEDGE_HALF_WIDTH_DEG, armLength - 6);
  const wedgeTo = pointAt(desiredElevation - WEDGE_HALF_WIDTH_DEG, armLength - 6);
  // the dish plane is perpendicular to its (magnified-error) boresight
  const dishHalf = 26;
  const dishPlaneAngleRad = ((displayedElevation - 90) * Math.PI) / 180;
  const dishFrom = {
    x: pivotX - Math.cos(dishPlaneAngleRad) * dishHalf,
    y: pivotY + Math.sin(dishPlaneAngleRad) * dishHalf,
  };
  const dishTo = {
    x: pivotX + Math.cos(dishPlaneAngleRad) * dishHalf,
    y: pivotY - Math.sin(dishPlaneAngleRad) * dishHalf,
  };

  return (
    <div className="instrument-panel">
      <InstrumentHead label="Tilt" isGood={isGood} />
      <svg width="100%" viewBox={`0 0 ${width} ${height - 30}`}>
        <g transform="translate(0,-16)">
          {arcDots.map((elevationDeg) => {
            const dotPoint = pointAt(elevationDeg, armLength + 14);
            const isMajorTick = Math.round(elevationDeg) % 15 < 3;
            return (
              <circle
                key={elevationDeg}
                cx={dotPoint.x}
                cy={dotPoint.y}
                r={isMajorTick ? 1.7 : 1.1}
                fill="var(--ink-muted)"
                opacity={0.8}
              />
            );
          })}
          <path
            d={`M${pivotX},${pivotY} L${wedgeFrom.x.toFixed(1)},${wedgeFrom.y.toFixed(1)} A${armLength - 6},${armLength - 6} 0 0 1 ${wedgeTo.x.toFixed(1)},${wedgeTo.y.toFixed(1)} Z`}
            fill="var(--ink-muted)"
            opacity={0.22}
          />
          <line
            x1={pivotX}
            y1={pivotY}
            x2={desiredPoint.x}
            y2={desiredPoint.y}
            stroke="var(--chart-warm)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* actual boresight needle (magnified error) */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={pointAt(displayedElevation, armLength - 18).x}
            y2={pointAt(displayedElevation, armLength - 18).y}
            stroke="var(--chart-ink)"
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.85}
          />
          {/* dish panel + mast */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={pivotX}
            y2={pivotY + 22}
            stroke="var(--chart-ink)"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.7}
          />
          <line
            x1={dishFrom.x}
            y1={dishFrom.y}
            x2={dishTo.x}
            y2={dishTo.y}
            stroke="var(--chart-ink)"
            strokeWidth={6}
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}

export function AlignmentPanel({ status }: { status: DishStatusJson }) {
  const alignment = status.alignmentStats ?? {};
  const verdict = alignmentVerdict(status);
  const isAligned = verdict === "aligned";

  return (
    <div>
      <div
        className="stat-caption"
        style={{ color: isAligned ? "var(--status-good)" : "var(--chart-warm)", fontWeight: 600, fontSize: 13.5 }}
      >
        {isAligned
          ? "Starlink is aligned — pointed in the correct direction."
          : "Starlink wants to point elsewhere — adjust the dish."}
      </div>

      <div className="instrument-row">
        <RotationInstrument alignment={alignment} />
        <TiltInstrument alignment={alignment} />
      </div>

      <div className="device-grid device-grid-two">
        <div className="device-row">
          <span className="device-label">Azimuth</span>
          <span className="mono-value">
            {(alignment.boresightAzimuthDeg ?? 0).toFixed(1)}° → {(alignment.desiredBoresightAzimuthDeg ?? 0).toFixed(1)}°
          </span>
        </div>
        <div className="device-row">
          <span className="device-label">Elevation</span>
          <span className="mono-value">
            {(alignment.boresightElevationDeg ?? 0).toFixed(1)}° → {(alignment.desiredBoresightElevationDeg ?? 0).toFixed(1)}°
          </span>
        </div>
        <div className="device-row">
          <span className="device-label">Tilt</span>
          <span className="mono-value">{(alignment.tiltAngleDeg ?? 0).toFixed(1)}°</span>
        </div>
        <div className="device-row">
          <span className="device-label">Attitude uncertainty</span>
          <span className="mono-value">±{(alignment.attitudeUncertaintyDeg ?? 0).toFixed(2)}°</span>
        </div>
        <div className="device-row">
          <span className="device-label">Attitude filter</span>
          <span className="mono-value">{(alignment.attitudeEstimationState ?? "—").replaceAll("_", " ").toLowerCase()}</span>
        </div>
        <div className="device-row">
          <span className="device-label">GPS</span>
          <span className="mono-value">
            {status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix"}
          </span>
        </div>
      </div>

      <div className="stat-caption" style={{ marginTop: 12 }}>
        white = the dish now · orange = where it wants to point · gray wedge = aligned tolerance. Pointing
        errors are drawn ×{ERROR_MAGNIFICATION} so sub-degree offsets stay visible — the numbers below are
        true values, updating live every 2 s.
      </div>
    </div>
  );
}
