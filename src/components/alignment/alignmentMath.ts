// The alignment math, ported 1:1 from the dish's own web app. This is SpaceX's
// algorithm, not an interpretation:
//  - alignment logic  = their `Nd`: great-circle separation < 5° against a
//    target elevation band (70°…75° for fixed standard kits, up to 90° for
//    mobile/low-tilt kits), azimuth tolerance widening near zenith
//  - azimuth tolerance = their `Ld` (spherical law of cosines solved for the
//    azimuth offset that produces a 5° separation)
//  - separation        = their `Ed`
//
// Kept apart from the instruments that draw it: this is the whole reason the
// panel can say "aligned", and it is checkable without an SVG.

import type { DishStatusJson } from "../../lib/dishClient";

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const SEPARATION_LIMIT_DEG = 5;

/** Their `Ed`: great-circle angular separation between two pointing directions. */
export function angularSeparationDeg(
  azimuthA: number,
  elevationA: number,
  azimuthB: number,
  elevationB: number,
): number {
  const cosSeparation =
    Math.sin(elevationA * DEG_TO_RAD) * Math.sin(elevationB * DEG_TO_RAD) +
    Math.cos(elevationA * DEG_TO_RAD) *
      Math.cos(elevationB * DEG_TO_RAD) *
      Math.cos((azimuthA - azimuthB) * DEG_TO_RAD);
  const separation = Math.acos(Math.min(1, Math.max(-1, cosSeparation))) * RAD_TO_DEG;
  return Number.isNaN(separation) ? 0 : separation;
}

/** Their `Ld`: azimuth offset at which separation hits 5°, given the two elevations. */
export function azimuthToleranceDeg(targetElevation: number, currentElevation: number): number {
  const targetRad = targetElevation * DEG_TO_RAD;
  const currentRad = currentElevation * DEG_TO_RAD;
  const limitRad = SEPARATION_LIMIT_DEG * DEG_TO_RAD;
  const denominator = Math.cos(targetRad) * Math.cos(currentRad);
  const cosAzimuth =
    (Math.cos(limitRad) - Math.sin(currentRad) * Math.sin(targetRad)) / denominator;
  if (cosAzimuth < -1) return 180;
  const tolerance = Math.acos(cosAzimuth) * RAD_TO_DEG;
  return Number.isNaN(tolerance) ? 0 : tolerance;
}

/** Signed shortest way round, in (-180, 180]. */
export function wrapDegrees(angleDeg: number): number {
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
    desiredElevationRaw !== undefined && desiredElevationRaw !== 0
      ? Math.min(70, desiredElevationRaw)
      : 70;
  const desiredAzimuth = stats?.desiredBoresightAzimuthDeg ?? 0;
  const currentAzimuth = status.boresightAzimuthDeg ?? 0;
  const currentElevation = status.boresightElevationDeg ?? 0;

  const separationAtTarget = angularSeparationDeg(
    desiredAzimuth,
    targetElevation,
    currentAzimuth,
    currentElevation,
  );
  const separationAtBandTop = angularSeparationDeg(
    desiredAzimuth,
    maxTargetElevation,
    currentAzimuth,
    currentElevation,
  );
  const azimuthDiff = wrapDegrees(desiredAzimuth - currentAzimuth);
  const isValid =
    stats?.attitudeEstimationState === "FILTER_CONVERGED" ||
    stats?.attitudeEstimationState === "FILTER_UNCONVERGED";
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
  const upperLimit = Math.max(
    Math.min((bandUsable ? maxTargetElevation : targetElevation) + 5, 90),
    0,
  );
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
