// Which kit the dish is, resolved from the hardwareVersion it reports, plus the
// per-model facts that are not geometry.
//
// The geometry itself lives in components/satellite/dishModels — one baked mesh
// per kit, converted from the manufacturer's own exports, which is what the sky
// dome draws. Nothing here builds geometry; it resolves identity and mount facts
// only.

import type { DishStatusJson } from "@core/dishClient";

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
  | "aviation"
  | "mini1"
  | "mini2"
  /** Hardware this table doesn't know. Draws the Standard as a stand-in, but is
   *  named as unknown rather than claiming to be a kit the user doesn't own. */
  | "unknown";

/**
 * Their `Vl`, ported: the model from the hardware string plus the actuator flag.
 *
 * Prefix tests, in their order, and the order carries meaning — every Performance
 * Gen 3 reports a `rev4_hp…` string, so testing `rev4` first would swallow it. A
 * substring match does the same thing, which is why this is prefix-based rather
 * than a list of regexes.
 *
 * Some families spell the revision with a redundant `rev_` before the real token
 * — `rev_hp1_proto0` (Performance Gen 1 and 2), `rev_rev1_proto3` (a V1
 * prototype). Stripping it lets the one prefix table below cover both spellings;
 * without it those strings match nothing and fall through to `unknown`, drawing a
 * mast-mounted Performance kit as a Standard on a kickstand.
 *
 * `high_perf` and `flat_hp` are deliberately not matched: no dish has been
 * observed reporting either, and an unmatched dish falls through to `unknown`
 * rather than asserting a guess.
 */
export function resolveDishModel(
  hardwareVersion: string | undefined,
  motorised: boolean,
): DishModel {
  const hardware = (hardwareVersion?.toLowerCase() ?? "").replace(/^rev_/, "");
  if (hardware === "") return "unknown";
  // Before both HP tests: the aviation kits spell themselves `hp1_aviation_*` and
  // `rev4_hp_aviation_*`, so either prefix below would swallow them and draw an
  // airliner's terminal as a mast or flat Performance kit.
  if (hardware.includes("aviation")) return "aviation";
  if (hardware.startsWith("hp")) return motorised ? "performanceGen1" : "performanceGen2";
  if (hardware.startsWith("rev3") || hardware.startsWith("dishy")) return "rev3Rectangular";
  if (hardware.startsWith("rev1") || hardware.startsWith("rev2")) return "rev2Circular";
  if (hardware.startsWith("rev4_hp")) return "performanceGen3";
  if (hardware.startsWith("rev4")) return "rev4Standard";
  if (hardware.startsWith("rev5")) return "rev5Standard";
  // Mini 1 (including Rugged) is the unit with the dark side band; Mini 2 is white.
  if (hardware.startsWith("mini1")) return "mini1";
  if (hardware.startsWith("mini2")) return "mini2";
  return "unknown";
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

// defaultTiltDeg is from the dish web app's own model table. Panel dimensions are
// not here: each baked model in dishModels carries its own, measured off the export
// it was converted from, so the mesh and its dimensions cannot disagree.
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
  // Flat like the Performance kits it is built from, so it clears the 8° bar and
  // may aim to zenith — right for a terminal that spends its life level.
  aviation: { displayName: "Aviation", mount: "flat", defaultTiltDeg: 0 },
  // Mount and tilt match the Standard, whose body stands in for it: unrecognised
  // hardware gets the commonest kit's alignment limits, and a name that admits it
  // is a guess rather than asserting a model.
  unknown: { displayName: "Unknown Model", mount: "kickstand", defaultTiltDeg: 20 },
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
