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

import type { DishStatusJson } from "@core/dishClient";
import { resolveDishModel, specForModel } from "../../lib/dishMesh";

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
  /** Floor of the acceptable elevation band, NOT the dish's target: their `Nd`
   *  caps it at 70° (`min(70, desired)`), so a dish asking for 76° still yields
   *  70 here and is judged against the band [70°, 75°]. Anything that wants the
   *  dish's actual target — a pointing error, a printed figure — must use
   *  `desiredElevationDeg`, which is unclamped. */
  targetElevationDeg: number;
  maxTargetElevationDeg: number;
  /** The dish's own target elevation, exactly as it reports it. */
  desiredElevationDeg: number;
  /** Great-circle angle between where the dish points and where it wants to
   *  point — the single figure Starlink support quotes as "boresight error". */
  boresightErrorDeg: number;
  /** Signed current − target, per axis, for the "move it this way" readouts the
   *  old web portal called its tilt and rotate recommendations. */
  elevationErrorDeg: number;
  azimuthErrorDeg: number;
  tiltAngleDeg: number;
}

/** Their `Nd`, ported. Uses top-level boresight fields exactly as their code does. */
export function computeAlignment(status: DishStatusJson): AlignmentReading {
  const stats = status.alignmentStats;
  // Their band ceiling, ported exactly:
  //   (mobilityClass === MOBILE || defaultTiltDeg < 8) ? 90 : 75
  // Only the flat kits (Performance Gen 2 and Gen 3, both 0°) clear the 8° bar —
  // the Mini's default tilt is 20°, so it takes 75 like a standard kit. A MOBILE
  // install gets 90 whatever the model, since it can be aimed from anywhere.
  // Top-level `hasActuators` only, as their `Vl` reads it — not the copy on
  // alignmentStats. The two can disagree, and on an `hp` string this flag alone
  // decides Gen 1 (tilt 25°, ceiling 75°) versus Gen 2 (tilt 0°, ceiling 90°).
  const motorised = status.hasActuators === "HAS_ACTUATORS_YES";
  const model = resolveDishModel(status.deviceInfo?.hardwareVersion, motorised);
  const maxTargetElevation =
    status.mobilityClass === "MOBILE" || specForModel(model).defaultTiltDeg < 8 ? 90 : 75;
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

  // Pointing error against the dish's *unclamped* target. Using targetElevation
  // here would read 6.5° on a dish asking for 76°, which is band arithmetic, not
  // a pointing error.
  const desiredElevation = desiredElevationRaw ?? currentElevation;
  const tiltAngle = stats?.tiltAngleDeg ?? 0;

  return {
    desiredElevationDeg: desiredElevation,
    boresightErrorDeg: angularSeparationDeg(
      currentAzimuth,
      currentElevation,
      desiredAzimuth,
      desiredElevation,
    ),
    elevationErrorDeg: currentElevation - desiredElevation,
    azimuthErrorDeg: wrapDegrees(currentAzimuth - desiredAzimuth),
    tiltAngleDeg: tiltAngle,
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
