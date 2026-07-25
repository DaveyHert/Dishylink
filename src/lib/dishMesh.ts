// Which kit the dish is, resolved from the hardwareVersion it reports, plus the
// per-model facts that are not geometry.
//
// The geometry itself lives in components/satellite/dishModels — one baked mesh
// per kit, converted from the manufacturer's own exports, which is what the sky
// dome draws. This file no longer generates any: it grew a panel procedurally
// from published dimensions until the baked models replaced it.

import type { DishStatusJson } from "./dishClient";

/** The kit models SpaceX's own web app distinguishes (their `zl`). One id per
 *  model, resolved once, so geometry and alignment can't disagree about which
 *  dish this is. */
export type DishModel =
  | "rev2Circular"
  | "rev3Rectangular"
  | "rev4Standard"
  | "rev5Standard"
  | "performanceGen1"
  | "performanceGen2"
  | "performanceGen3"
  | "mini1"
  | "mini2";

/**
 * Their `Vl`, ported: the model from the hardware string plus the actuator flag.
 *
 * Prefix tests, in their order, and the order carries meaning — every HP Gen 4
 * reports a `rev4_hp…` string, so testing `rev4` first would swallow it. A
 * substring match does the same thing, which is why this is prefix-based rather
 * than a list of regexes.
 *
 * Some families spell the revision with a redundant `rev_` before the real token
 * — `rev_hp1_proto0` (Performance Gen 1 and 2), `rev_rev1_proto3` (a V1
 * prototype). Stripping it lets the one prefix table below cover both spellings;
 * without it those strings match nothing and fall through to `v4`, drawing a
 * mast-mounted High Performance kit as a Standard on a kickstand.
 *
 * An earlier version of this table also matched `high_perf` and `flat_hp`
 * anywhere in the string; no dish has been observed reporting either, and a dish
 * that did would resolve to `v4` here exactly as it would in their app.
 */
export function resolveDishModel(
  hardwareVersion: string | undefined,
  motorised: boolean,
): DishModel {
  const hardware = (hardwareVersion?.toLowerCase() ?? "").replace(/^rev_/, "");
  if (hardware === "") return "rev4Standard";
  if (hardware.startsWith("hp")) return motorised ? "performanceGen1" : "performanceGen2";
  if (hardware.startsWith("rev3") || hardware.startsWith("dishy")) return "rev3Rectangular";
  if (hardware.startsWith("rev1") || hardware.startsWith("rev2")) return "rev2Circular";
  if (hardware.startsWith("rev4_hp")) return "performanceGen3";
  if (hardware.startsWith("rev4")) return "rev4Standard";
  if (hardware.startsWith("rev5")) return "rev5Standard";
  // Mini 1 (including Rugged) is the unit with the dark side band; Mini 2 is white.
  if (hardware.startsWith("mini1")) return "mini1";
  if (hardware.startsWith("mini2")) return "mini2";
  return "rev4Standard";
}

/** The kit to draw, straight from a status reply. Every surface that renders
 *  hardware resolves through here, so the dome, the speed test and the alignment
 *  card cannot disagree about which dish this is. */
export function dishModelFor(status: DishStatusJson | null): DishModel {
  return resolveDishModel(
    status?.deviceInfo?.hardwareVersion,
    status?.hasActuators === "HAS_ACTUATORS_YES",
  );
}

export interface DishModelSpec {
  /** The kit's marketing name, for naming a model in prose. */
  displayName: string;
  mount: "kickstand" | "mast" | "flat";
  /** Default plate tilt, from their `Gl`. Kits that sit near flat (under 8°)
   *  are allowed to aim all the way to zenith — see alignmentMath.ts. */
  defaultTiltDeg: number;
}

// defaultTiltDeg is from the dish web app's own model table. Panel dimensions
// used to sit here to grow the mesh procedurally; each baked model in dishModels
// now carries its own, measured off the export it was converted from.
const MODEL_SPECS: Record<DishModel, DishModelSpec> = {
  rev4Standard: { displayName: "Standard 4", mount: "kickstand", defaultTiltDeg: 20 },
  rev5Standard: { displayName: "Starlink V5", mount: "kickstand", defaultTiltDeg: 13 },
  rev3Rectangular: { displayName: "Actuated", mount: "mast", defaultTiltDeg: 25 },
  rev2Circular: { displayName: "Standard Circular", mount: "mast", defaultTiltDeg: 25 },
  mini1: { displayName: "Mini", mount: "kickstand", defaultTiltDeg: 20 },
  mini2: { displayName: "Mini 2", mount: "kickstand", defaultTiltDeg: 20 },
  // The app names Performance kits by physical generation: the mast kit is Gen 1,
  // the flat rev_hp1 kit is Gen 2, the flat rev4_hp kit is Gen 3.
  performanceGen1: { displayName: "Performance (Gen 1)", mount: "mast", defaultTiltDeg: 25 },
  performanceGen2: { displayName: "Performance (Gen 2)", mount: "flat", defaultTiltDeg: 0 },
  performanceGen3: { displayName: "Performance (Gen 3)", mount: "flat", defaultTiltDeg: 0 },
};

export function specForModel(model: DishModel): DishModelSpec {
  return MODEL_SPECS[model];
}

export function specForHardware(
  hardwareVersion: string | undefined,
  motorised = false,
): DishModelSpec {
  return MODEL_SPECS[resolveDishModel(hardwareVersion, motorised)];
}
