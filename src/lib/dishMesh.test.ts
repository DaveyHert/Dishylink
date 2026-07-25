// Every hardware string SpaceX's terminal table lists (July 2026), resolved.
//
// The resolver is prefix-based, so a family whose codename sits mid-string
// (gopher, panda, catapult, pez) needs no rule of its own — but a family that
// spells its revision differently silently lands on the `v4` fallback, which is
// how Performance Gen 1 and 2 came to draw as a Standard on a kickstand. This
// pins one string per spelling rather than one per family.

import { expect, test } from "vitest";
import { resolveDishModel, specForModel, type DishModel } from "./dishMesh";
import { meshForModel } from "../components/satellite/dishModels";

/** [hardwareVersion, expected model]. Motorised kits are listed twice. */
const TABLE: Array<[string, DishModel]> = [
  // REV1 Original / V1 and REV2 circular / V2 share the round body: the table
  // calls V2 an internal redesign of the same shape, "often mistakenly referred
  // to as V1", and nothing visible distinguishes them.
  ["rev1_pre_production", "rev2Circular"],
  ["rev1_production", "rev2Circular"],
  ["rev_rev1_proto3", "rev2Circular"],
  ["rev2_proto1", "rev2Circular"],
  ["rev2_proto4", "rev2Circular"],

  ["rev3_proto0", "rev3Rectangular"],
  ["rev3_proto2", "rev3Rectangular"],

  // REV4 Standard, plus the CPU/antenna variants: catapult, gopher, panda.
  ["rev4_prod1", "rev4Standard"],
  ["rev4_prod3", "rev4Standard"],
  ["rev4_catapult_prod1", "rev4Standard"],
  ["rev4_gopher_prod1", "rev4Standard"],
  ["rev4_panda_prod2", "rev4Standard"],

  // Performance Gen 3 reports rev4_hp_*, which must be tested before rev4_*.
  ["rev4_hp_prod1", "performanceGen3"],
  ["rev4_hp_prod2", "performanceGen3"],
  ["rev4_hp_aviation_prod1", "performanceGen3"],

  ["mini1_prod1", "mini1"],
  ["mini1_panda_prod4", "mini1"],
  ["mini1_pez_proto1", "mini1"],
  ["mini1_rugged_prod1", "mini1"],
  ["mini2_prod1", "mini2"],

  ["rev5_pez_prod1", "rev5Standard"],
  ["rev5_pez_prod2", "rev5Standard"],
  ["rev5_pez_auto_proto1", "rev5Standard"],
];

test.each(TABLE)("%s resolves to %s", (hardware, expected) => {
  // These families are all unmotorised in the table, so the actuator flag must
  // not change the answer.
  expect(resolveDishModel(hardware, false)).toBe(expected);
  expect(resolveDishModel(hardware, true)).toBe(expected);
});

// Performance Gen 1 and 2 (rev_hp1_*) and the Aviation HP (hp1_*) are the two
// spellings of a High Performance kit, and the actuator flag picks the mount.
const HP_STRINGS = ["rev_hp1_proto0", "rev_hp1_proto2", "rev_hp1_proto3", "hp1_aviation_proto0", "hp1_aviation_prod2"];

test.each(HP_STRINGS)("%s is a High Performance kit, mount by actuator", (hardware) => {
  // Motorised → mast → Gen 1; flat → Gen 2. The hardware string can't tell Gen 1
  // from Gen 2 (both are rev_hp1_*), so the actuator flag is what splits them.
  expect(resolveDishModel(hardware, true)).toBe("performanceGen1");
  expect(resolveDishModel(hardware, false)).toBe("performanceGen2");
});

test("an absent or unrecognised hardware string falls back to the Standard", () => {
  expect(resolveDishModel(undefined, false)).toBe("rev4Standard");
  expect(resolveDishModel("", false)).toBe("rev4Standard");
  expect(resolveDishModel("rev9_something_new", false)).toBe("rev4Standard");
});

test("every model the resolver can return has a mesh and a spec", () => {
  const models = new Set<DishModel>([
    ...TABLE.map(([, model]) => model),
    "performanceGen1",
    "performanceGen2",
  ]);
  for (const model of models) {
    expect(meshForModel(model), model).toBeTruthy();
    expect(specForModel(model).displayName, model).toBeTruthy();
  }
});
