// Alignment instruments ported 1:1 from the dish's own web app (bundle
// fetched from http://192.168.100.1/static/js/script.js.gz). The math is
// SpaceX's, not an interpretation:
//  - alignment logic  = their `Nd`: great-circle separation < 5° against a
//    target elevation band (70°…75° for fixed standard kits, up to 90° for
//    mobile/low-tilt kits), azimuth tolerance widening near zenith
//  - azimuth tolerance = their `Ld` (spherical law of cosines solved for the
//    azimuth offset that produces a 5° separation)
//  - Rotation drawing  = their `xd`: dotted ring (gaps at the cardinals),
//    sector wedge = desired ± tolerance, white dish rect + ORANGE needle
//    both rotated to the ACTUAL azimuth
//  - Tilt drawing      = their `Ad`: y-flipped quarter arc, wedge spanning
//    the valid elevation band, dish plate + orange needle at the ACTUAL
//    elevation. Their needle orange is #ffac30.

import type { DishStatusJson } from "../lib/dishClient";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const SEPARATION_LIMIT_DEG = 5;
const NEEDLE_ORANGE = "#ffac30";

// ---------- SpaceX's alignment math (their Nd/Ld/Ed) ----------

/** Their `Ed`: great-circle angular separation between two pointing directions. */
function angularSeparationDeg(azimuthA: number, elevationA: number, azimuthB: number, elevationB: number): number {
  const cosSeparation =
    Math.sin(elevationA * DEG_TO_RAD) * Math.sin(elevationB * DEG_TO_RAD) +
    Math.cos(elevationA * DEG_TO_RAD) * Math.cos(elevationB * DEG_TO_RAD) * Math.cos((azimuthA - azimuthB) * DEG_TO_RAD);
  const separation = Math.acos(Math.min(1, Math.max(-1, cosSeparation))) * RAD_TO_DEG;
  return Number.isNaN(separation) ? 0 : separation;
}

/** Their `Ld`: azimuth offset at which separation hits 5°, given the two elevations. */
function azimuthToleranceDeg(targetElevation: number, currentElevation: number): number {
  const targetRad = targetElevation * DEG_TO_RAD;
  const currentRad = currentElevation * DEG_TO_RAD;
  const limitRad = SEPARATION_LIMIT_DEG * DEG_TO_RAD;
  const denominator = Math.cos(targetRad) * Math.cos(currentRad);
  const cosAzimuth = (Math.cos(limitRad) - Math.sin(currentRad) * Math.sin(targetRad)) / denominator;
  if (cosAzimuth < -1) return 180;
  const tolerance = Math.acos(cosAzimuth) * RAD_TO_DEG;
  return Number.isNaN(tolerance) ? 0 : tolerance;
}

function wrapDegrees(angleDeg: number): number {
  const wrapped = ((angleDeg % 360) + 360) % 360;
  return wrapped < 180 ? wrapped : wrapped - 360;
}

export interface AlignmentReading {
  isValid: boolean;
  isAligned: boolean;
  boresightAzimuthDeg: number;
  boresightElevationDeg: number;
  desiredAzimuthDeg: number;
  azimuthToleranceDeg: number;
  upperElevationLimitDeg: number;
  lowerElevationLimitDeg: number;
  isElevationValid: boolean;
  targetElevationDeg: number;
  maxTargetElevationDeg: number;
}

/** Their `Nd`, ported. Uses top-level boresight fields exactly as their code does. */
export function computeAlignment(status: DishStatusJson): AlignmentReading {
  const stats = status.alignmentStats;
  // Their code: 90° band ceiling for MOBILE dishes or kits with default tilt
  // < 8° (Mini/HP); fixed standard kits like rev4 get 75°.
  const maxTargetElevation = 75;
  const desiredElevationRaw = stats?.desiredBoresightElevationDeg;
  const targetElevation =
    desiredElevationRaw !== undefined && desiredElevationRaw !== 0 ? Math.min(70, desiredElevationRaw) : 70;
  const desiredAzimuth = stats?.desiredBoresightAzimuthDeg ?? 0;
  const currentAzimuth = status.boresightAzimuthDeg ?? 0;
  const currentElevation = status.boresightElevationDeg ?? 0;

  const separationAtTarget = angularSeparationDeg(desiredAzimuth, targetElevation, currentAzimuth, currentElevation);
  const separationAtBandTop = angularSeparationDeg(desiredAzimuth, maxTargetElevation, currentAzimuth, currentElevation);
  const azimuthDiff = wrapDegrees(desiredAzimuth - currentAzimuth);
  const isValid =
    stats?.attitudeEstimationState === "FILTER_CONVERGED" || stats?.attitudeEstimationState === "FILTER_UNCONVERGED";
  const bandUsable = targetElevation >= 50;

  // their `w`: azimuth error projected onto the sky at the current elevation
  const effectiveAzimuthError =
    Math.acos(
      Math.sqrt(
        Math.cos(azimuthDiff * DEG_TO_RAD) ** 2 * Math.cos(currentElevation * DEG_TO_RAD) ** 2 +
          Math.sin(currentElevation * DEG_TO_RAD) ** 2,
      ),
    ) * RAD_TO_DEG;

  const alignedAtTarget = isValid && separationAtTarget < SEPARATION_LIMIT_DEG;
  const alignedAtBandTop = isValid && bandUsable && separationAtBandTop < SEPARATION_LIMIT_DEG;
  const alignedInsideBand =
    isValid &&
    bandUsable &&
    currentElevation > targetElevation &&
    currentElevation < maxTargetElevation &&
    Math.abs(azimuthDiff) < 90 &&
    Math.abs(effectiveAzimuthError) < SEPARATION_LIMIT_DEG;
  const isAligned = alignedAtTarget || alignedAtBandTop || alignedInsideBand;

  const tolerance = Math.max(
    azimuthToleranceDeg(targetElevation, currentElevation),
    bandUsable ? azimuthToleranceDeg(maxTargetElevation, currentElevation) : 0,
    bandUsable && currentElevation > targetElevation && currentElevation < maxTargetElevation
      ? azimuthToleranceDeg(currentElevation, currentElevation)
      : 0,
  );
  const upperLimit = Math.max(Math.min((bandUsable ? maxTargetElevation : targetElevation) + 5, 90), 0);
  const lowerLimit = Math.max(Math.min(targetElevation - 5, 90), 0);

  return {
    isValid,
    isAligned,
    boresightAzimuthDeg: currentAzimuth,
    boresightElevationDeg: currentElevation,
    desiredAzimuthDeg: desiredAzimuth,
    azimuthToleranceDeg: tolerance,
    upperElevationLimitDeg: upperLimit,
    lowerElevationLimitDeg: lowerLimit,
    isElevationValid: currentElevation > lowerLimit && currentElevation < upperLimit,
    targetElevationDeg: targetElevation,
    maxTargetElevationDeg: maxTargetElevation,
  };
}

// ---------- shared drawing pieces (their Cd ring and Id sector) ----------

/** Filled sector (pie slice), angles in SVG degrees from the +x axis. */
function sectorPath(centerX: number, centerY: number, radius: number, thetaCenterDeg: number, thetaDeg: number): string {
  const startRad = (thetaCenterDeg - thetaDeg / 2) * DEG_TO_RAD;
  const endRad = (thetaCenterDeg + thetaDeg / 2) * DEG_TO_RAD;
  const largeArc = thetaDeg > 180 ? 1 : 0;
  const startX = centerX + radius * Math.cos(startRad);
  const startY = centerY + radius * Math.sin(startRad);
  const endX = centerX + radius * Math.cos(endRad);
  const endY = centerY + radius * Math.sin(endRad);
  return `M${centerX},${centerY} L${startX.toFixed(2)},${startY.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${endX.toFixed(2)},${endY.toFixed(2)} Z`;
}

function InstrumentHead({ label, berry }: { label: string; berry: "good" | "bad" | "unknown" }) {
  const berryColor =
    berry === "good" ? "var(--status-good)" : berry === "bad" ? "var(--status-critical)" : "var(--ink-muted)";
  return (
    <div className="instrument-head">
      <span className="micro-label">{label}</span>
      <span className="status-dot" style={{ background: berryColor }} />
    </div>
  );
}

// ---------- Rotation (their xd, size ratios verbatim) ----------

function RotationInstrument({ reading }: { reading: AlignmentReading }) {
  const size = 250;
  const center = size / 2;
  const ringRadius = 0.45 * size;
  const dishWidth = size / 8;
  const dishHeight = size / 6;
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
    <div className="instrument-panel">
      <InstrumentHead
        label="Rotation"
        berry={reading.isAligned ? "good" : reading.isValid ? "bad" : "unknown"}
      />
      <svg width="100%" viewBox={`0 0 ${size} ${size}`}>
        {ringDots.map((angleDeg) => {
          const angleRad = (angleDeg - 90) * DEG_TO_RAD;
          return (
            <circle
              key={angleDeg}
              cx={center + ringRadius * Math.cos(angleRad)}
              cy={center + ringRadius * Math.sin(angleRad)}
              r={1.2}
              fill="var(--ink-secondary)"
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
              dy="0.35em"
              textAnchor="middle"
              fontSize={size / 20}
              fontWeight={600}
              fill="var(--ink-secondary)"
              fontFamily="var(--font-ui)"
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
            fill="var(--ink-muted)"
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
            fill="var(--chart-ink)"
          />
          {reading.isValid && (
            <line
              x1={center}
              y1={center}
              x2={center}
              y2={center - 0.94 * ringRadius}
              stroke={NEEDLE_ORANGE}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )}
        </g>
      </svg>
    </div>
  );
}

// ---------- Tilt (their Ad: y-flipped quarter arc, ratios verbatim) ----------

function TiltInstrument({ reading }: { reading: AlignmentReading }) {
  const size = 250;
  const pivot = size / 6;
  const arcRadius = 0.77 * size;
  const dishLength = size / 4;
  const dishThickness = dishLength / 10;
  const needleElevation = reading.isValid ? reading.boresightElevationDeg : 70;

  const arcDots: number[] = [];
  for (let dotIndex = 0; dotIndex < 19; dotIndex++) arcDots.push(dotIndex * 5);

  return (
    <div className="instrument-panel">
      <InstrumentHead
        label="Tilt"
        berry={reading.isElevationValid ? "good" : reading.isValid ? "bad" : "unknown"}
      />
      <svg width="100%" viewBox={`0 0 ${size} ${size}`}>
        {/* their y-up coordinate system: translate(0, size) scale(1, -1) */}
        <g transform={`translate(0, ${size}) scale(1, -1)`}>
          {arcDots.map((angleDeg) => {
            const angleRad = angleDeg * DEG_TO_RAD;
            return (
              <circle
                key={angleDeg}
                cx={pivot + arcRadius * Math.cos(angleRad)}
                cy={pivot + arcRadius * Math.sin(angleRad)}
                r={1.2}
                fill="var(--ink-secondary)"
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
              fill="var(--ink-muted)"
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
              fill="var(--chart-ink)"
            />
            {reading.isValid && (
              <line
                x1={pivot}
                y1={pivot}
                x2={pivot}
                y2={pivot + 0.96 * arcRadius}
                stroke={NEEDLE_ORANGE}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            )}
          </g>
        </g>
      </svg>
    </div>
  );
}

// ---------- the sheet content ----------

export function AlignmentPanel({ status }: { status: DishStatusJson }) {
  const reading = computeAlignment(status);
  const stats = status.alignmentStats;

  return (
    <div>
      <div
        className="stat-caption"
        style={{
          color: reading.isAligned ? "var(--status-good)" : reading.isValid ? "var(--chart-warm)" : "var(--ink-muted)",
          fontWeight: 600,
          fontSize: 13.5,
        }}
      >
        {!reading.isValid
          ? "Attitude filter not ready — alignment data is settling."
          : reading.isAligned
            ? "Starlink is aligned — pointed in the correct direction."
            : "Starlink is not aligned — adjust the dish toward the wedge."}
      </div>

      <div className="instrument-row">
        <RotationInstrument reading={reading} />
        <TiltInstrument reading={reading} />
      </div>

      <div className="device-grid device-grid-two">
        <div className="device-row">
          <span className="device-label">Azimuth</span>
          <span className="mono-value">
            {reading.boresightAzimuthDeg.toFixed(1)}° · target {reading.desiredAzimuthDeg.toFixed(1)}° ±
            {reading.azimuthToleranceDeg.toFixed(0)}°
          </span>
        </div>
        <div className="device-row">
          <span className="device-label">Elevation</span>
          <span className="mono-value">
            {reading.boresightElevationDeg.toFixed(1)}° · band {reading.lowerElevationLimitDeg.toFixed(0)}–
            {reading.upperElevationLimitDeg.toFixed(0)}°
          </span>
        </div>
        <div className="device-row">
          <span className="device-label">Tilt</span>
          <span className="mono-value">{(stats?.tiltAngleDeg ?? 0).toFixed(1)}°</span>
        </div>
        <div className="device-row">
          <span className="device-label">Attitude uncertainty</span>
          <span className="mono-value">±{(stats?.attitudeUncertaintyDeg ?? 0).toFixed(2)}°</span>
        </div>
        <div className="device-row">
          <span className="device-label">Attitude filter</span>
          <span className="mono-value">{(stats?.attitudeEstimationState ?? "—").replaceAll("_", " ").toLowerCase()}</span>
        </div>
        <div className="device-row">
          <span className="device-label">GPS</span>
          <span className="mono-value">
            {status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix"}
          </span>
        </div>
      </div>

      <div className="stat-caption" style={{ marginTop: 12 }}>
        orange = where the dish is pointing · gray wedge = acceptable range. Geometry and thresholds are
        ported 1:1 from the dish's own alignment code; values update live every 2 s.
      </div>
    </div>
  );
}
