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
export type DishModel = "v2" | "v3" | "v4" | "v5" | "hp" | "flatHp" | "hpV4" | "mini";

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
  if (hardware === "") return "v4";
  if (hardware.startsWith("hp")) return motorised ? "hp" : "flatHp";
  if (hardware.startsWith("rev3") || hardware.startsWith("dishy")) return "v3";
  if (hardware.startsWith("rev1") || hardware.startsWith("rev2")) return "v2";
  if (hardware.startsWith("rev4_hp")) return "hpV4";
  if (hardware.startsWith("rev4")) return "v4";
  if (hardware.startsWith("rev5")) return "v5";
  if (hardware.startsWith("mini1") || hardware.startsWith("mini2")) return "mini";
  return "v4";
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
  v4: { displayName: "Standard (Gen 3)", mount: "kickstand", defaultTiltDeg: 20 },
  v5: { displayName: "Standard (Gen 4)", mount: "kickstand", defaultTiltDeg: 13 },
  v3: { displayName: "Standard Actuated (Gen 2)", mount: "mast", defaultTiltDeg: 25 },
  v2: { displayName: "Original (round)", mount: "mast", defaultTiltDeg: 25 },
  mini: { displayName: "Mini", mount: "kickstand", defaultTiltDeg: 20 },
  hp: { displayName: "High Performance", mount: "mast", defaultTiltDeg: 25 },
  flatHp: { displayName: "Flat High Performance", mount: "flat", defaultTiltDeg: 0 },
  hpV4: { displayName: "High Performance (Gen 4)", mount: "flat", defaultTiltDeg: 0 },
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
