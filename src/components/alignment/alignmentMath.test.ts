import { describe, expect, it } from "vitest";
import type { DishStatusJson } from "@core/dishClient";
import {
  SEPARATION_LIMIT_DEG,
  angularSeparationDeg,
  azimuthToleranceDeg,
  computeAlignment,
  wrapDegrees,
} from "./alignmentMath";
import { resolveDishModel } from "../../lib/dishMesh";

describe("angularSeparationDeg", () => {
  it("is zero for a direction against itself", () => {
    expect(angularSeparationDeg(137, 62, 137, 62)).toBeCloseTo(0);
  });

  it("is symmetric", () => {
    const a = angularSeparationDeg(10, 40, 80, 65);
    const b = angularSeparationDeg(80, 65, 10, 40);
    expect(a).toBeCloseTo(b);
  });

  it("reduces to the elevation difference when azimuth matches", () => {
    expect(angularSeparationDeg(90, 70, 90, 55)).toBeCloseTo(15);
  });

  it("ignores azimuth entirely at the zenith", () => {
    // Straight up has no bearing, so any azimuth pair must agree.
    expect(angularSeparationDeg(0, 90, 180, 90)).toBeCloseTo(0);
  });

  it("gives 180° for exactly opposite directions", () => {
    expect(angularSeparationDeg(0, 90, 0, -90)).toBeCloseTo(180);
  });

  it("never returns NaN when the cosine overruns from rounding", () => {
    // acos of anything a hair outside [-1,1] is NaN; the port clamps first.
    for (const elevation of [-90, 0, 45, 90]) {
      expect(angularSeparationDeg(0, elevation, 0, elevation)).not.toBeNaN();
    }
  });
});

describe("azimuthToleranceDeg", () => {
  it("equals the separation limit when both point at the horizon", () => {
    // At elevation 0 an azimuth offset IS the great-circle separation.
    expect(azimuthToleranceDeg(0, 0)).toBeCloseTo(SEPARATION_LIMIT_DEG);
  });

  it("widens as the dish points higher", () => {
    // Near the zenith a given azimuth error sweeps a much smaller arc, so more
    // azimuth error is tolerable — this is the whole point of the function.
    const low = azimuthToleranceDeg(30, 30);
    const high = azimuthToleranceDeg(80, 80);
    expect(high).toBeGreaterThan(low);
  });

  it("saturates to 180° when every azimuth is within the limit", () => {
    // Two directions this close in elevation near the zenith can never be 5°
    // apart no matter the bearing.
    expect(azimuthToleranceDeg(89, 89)).toBe(180);
  });

  it("produces a tolerance consistent with the separation it is solving for", () => {
    // Offsetting azimuth by exactly the tolerance should land on ~5° apart.
    const target = 70;
    const current = 70;
    const tolerance = azimuthToleranceDeg(target, current);
    expect(angularSeparationDeg(0, target, tolerance, current)).toBeCloseTo(
      SEPARATION_LIMIT_DEG,
      3,
    );
  });
});

describe("wrapDegrees", () => {
  it("leaves a small positive angle alone", () => {
    expect(wrapDegrees(10)).toBe(10);
  });

  it("takes the short way round past 180", () => {
    expect(wrapDegrees(350)).toBe(-10);
    expect(wrapDegrees(190)).toBe(-170);
  });

  it("normalises negatives and multiple turns", () => {
    expect(wrapDegrees(-10)).toBe(-10);
    expect(wrapDegrees(730)).toBe(10);
    expect(wrapDegrees(-370)).toBe(-10);
  });
});

/** Minimal status shaped like the dish's, with only what the math reads. */
function statusAt(
  boresightAzimuthDeg: number,
  boresightElevationDeg: number,
  overrides: Partial<DishStatusJson["alignmentStats"]> = {},
): DishStatusJson {
  return {
    boresightAzimuthDeg,
    boresightElevationDeg,
    alignmentStats: {
      attitudeEstimationState: "FILTER_CONVERGED",
      desiredBoresightAzimuthDeg: 0,
      desiredBoresightElevationDeg: 70,
      ...overrides,
    },
  } as DishStatusJson;
}

describe("computeAlignment", () => {
  it("reports aligned when pointing straight at the target", () => {
    const reading = computeAlignment(statusAt(0, 70));
    expect(reading.isValid).toBe(true);
    expect(reading.isAligned).toBe(true);
    expect(reading.isElevationValid).toBe(true);
  });

  it("reports misaligned when swung well off the desired azimuth", () => {
    expect(computeAlignment(statusAt(90, 70)).isAligned).toBe(false);
  });

  it("stays aligned anywhere inside the 70–75° band", () => {
    // The band, not a single angle, is the target — this is the branch that
    // distinguishes the port from a naive "within 5° of 70°".
    expect(computeAlignment(statusAt(0, 73)).isAligned).toBe(true);
  });

  it("is neither valid nor aligned before the attitude filter converges", () => {
    const reading = computeAlignment(
      statusAt(0, 70, { attitudeEstimationState: "FILTER_INITIALIZING" }),
    );
    expect(reading.isValid).toBe(false);
    expect(reading.isAligned).toBe(false);
  });

  it("treats an unconverged-but-running filter as valid, as their code does", () => {
    expect(
      computeAlignment(statusAt(0, 70, { attitudeEstimationState: "FILTER_UNCONVERGED" })).isValid,
    ).toBe(true);
  });

  it("brackets the elevation band with 5° of slack on each side", () => {
    const reading = computeAlignment(statusAt(0, 70));
    expect(reading.lowerElevationLimitDeg).toBe(65); // target 70 − 5
    expect(reading.upperElevationLimitDeg).toBe(80); // band top 75 + 5
    expect(reading.targetElevationDeg).toBe(70);
    expect(reading.maxTargetElevationDeg).toBe(75);
  });

  it("marks elevation invalid outside those limits", () => {
    expect(computeAlignment(statusAt(0, 40)).isElevationValid).toBe(false);
    expect(computeAlignment(statusAt(0, 88)).isElevationValid).toBe(false);
  });

  it("never clamps a limit above 90°", () => {
    const reading = computeAlignment(statusAt(0, 70, { desiredBoresightElevationDeg: 89 }));
    expect(reading.upperElevationLimitDeg).toBeLessThanOrEqual(90);
    expect(reading.lowerElevationLimitDeg).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a 70° target when the dish reports none", () => {
    // proto3 omits a zero, so 0 means "not sent" rather than "aim at the horizon".
    expect(
      computeAlignment(statusAt(0, 70, { desiredBoresightElevationDeg: 0 })).targetElevationDeg,
    ).toBe(70);
  });
});

/** Status for a given kit, aimed near zenith — the elevation that separates a
 *  75° band ceiling from a 90° one. */
function kitAimedAt(
  elevationDeg: number,
  kit: { hardwareVersion?: string; hasActuators?: string; mobilityClass?: string },
): DishStatusJson {
  return {
    boresightAzimuthDeg: 0,
    boresightElevationDeg: elevationDeg,
    deviceInfo: { hardwareVersion: kit.hardwareVersion },
    hasActuators: kit.hasActuators,
    mobilityClass: kit.mobilityClass,
    alignmentStats: {
      attitudeEstimationState: "FILTER_CONVERGED",
      desiredBoresightAzimuthDeg: 0,
      desiredBoresightElevationDeg: 70,
    },
  } as DishStatusJson;
}

describe("resolveDishModel", () => {
  it("reads a Performance Gen 3 as its own model, not as a Standard", () => {
    // Every Performance Gen 3 string also starts with "rev4"; testing "rev4"
    // first — or matching it as a substring — swallows this case.
    expect(resolveDishModel("rev4_hp_prod1", false)).toBe("performanceGen3");
    expect(resolveDishModel("rev4_panda_prod2", false)).toBe("rev4Standard");
  });

  it("splits the HP line on whether it actually has motors", () => {
    expect(resolveDishModel("hp1_prod0", true)).toBe("performanceGen1");
    expect(resolveDishModel("hp1_prod0", false)).toBe("performanceGen2");
  });

  it("resolves an unknown or absent string to the unknown kit", () => {
    expect(resolveDishModel(undefined, false)).toBe("unknown");
    expect(resolveDishModel("something_new", false)).toBe("unknown");
  });
});

describe("computeAlignment band ceiling", () => {
  it("holds a standard kit to the 75° band", () => {
    expect(
      computeAlignment(kitAimedAt(85, { hardwareVersion: "rev4_panda_prod2" })).isAligned,
    ).toBe(false);
  });

  it("holds a Mini to the 75° band too", () => {
    // Its default tilt is 20°, not under 8° — the Mini is not a flat kit.
    expect(
      computeAlignment(kitAimedAt(85, { hardwareVersion: "mini1_panda_prod1" })).isAligned,
    ).toBe(false);
  });

  it("lets a flat kit aim to the zenith", () => {
    const flatPerformance = kitAimedAt(85, {
      hardwareVersion: "hp1_prod0",
      hasActuators: "HAS_ACTUATORS_NO",
    });
    expect(computeAlignment(flatPerformance).isAligned).toBe(true);
    expect(computeAlignment(flatPerformance).upperElevationLimitDeg).toBe(90);
    expect(computeAlignment(kitAimedAt(85, { hardwareVersion: "rev4_hp_prod1" })).isAligned).toBe(
      true,
    );
  });

  it("lets a MOBILE install aim to the zenith whatever the model", () => {
    const roaming = kitAimedAt(85, {
      hardwareVersion: "rev4_panda_prod2",
      mobilityClass: "MOBILE",
    });
    expect(computeAlignment(roaming).isAligned).toBe(true);
    expect(computeAlignment(roaming).upperElevationLimitDeg).toBe(90);
  });
});
