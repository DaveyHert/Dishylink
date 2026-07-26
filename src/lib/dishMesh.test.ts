// Every hardware string SpaceX's terminal table lists (July 2026), resolved.
//
// The resolver is prefix-based, so a family whose codename sits mid-string
// (gopher, panda, catapult, pez) needs no rule of its own — but a family that
// spells its revision differently silently lands on the unknown fallback, which
// is how Performance Gen 1 and 2 came to draw as a Standard on a kickstand. This
// pins one string per spelling rather than one per family.

import { expect, test } from "vitest";
import { resolveDishModel, specForModel, type DishModel } from "./dishMesh";
import { meshForModel } from "../components/satellite/dishModels";
import { buildDish } from "../components/satellite/skyGeometry";

/** Every kit the resolver can name, so a new one cannot skip these checks. */
const MODELS: DishModel[] = [
  "rev2Circular",
  "rev3Rectangular",
  "rev4Standard",
  "rev5Standard",
  "performanceGen1",
  "performanceGen2",
  "performanceGen3",
  "aviation",
  "mini1",
  "mini2",
  "unknown",
];

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
  ["rev4_hp_aviation_prod1", "aviation"],

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

// Performance Gen 1 and 2 both report rev_hp1_*, and the actuator flag picks the
// mount. The aviation kits are excluded on purpose — they spell themselves the
// same way but are their own model, pinned below.
const HP_STRINGS = ["rev_hp1_proto0", "rev_hp1_proto2", "rev_hp1_proto3"];

test.each(HP_STRINGS)("%s is a High Performance kit, mount by actuator", (hardware) => {
  // Motorised → mast → Gen 1; flat → Gen 2. The hardware string can't tell Gen 1
  // from Gen 2 (both are rev_hp1_*), so the actuator flag is what splits them.
  expect(resolveDishModel(hardware, true)).toBe("performanceGen1");
  expect(resolveDishModel(hardware, false)).toBe("performanceGen2");
});

test("an absent or unrecognised hardware string resolves to the unknown kit", () => {
  expect(resolveDishModel(undefined, false)).toBe("unknown");
  expect(resolveDishModel("", false)).toBe("unknown");
  expect(resolveDishModel("rev9_something_new", false)).toBe("unknown");
});

// All three aviation spellings, from the July 2026 table's Aviation row. Two
// start with `hp`, one with `rev4_hp`, so the branch has to precede both.
test.each(["hp1_aviation_proto0", "hp1_aviation_prod2", "rev4_hp_aviation_prod1"])(
  "%s is the aviation kit whatever the actuator flag says",
  (hardware) => {
    expect(resolveDishModel(hardware, true)).toBe("aviation");
    expect(resolveDishModel(hardware, false)).toBe("aviation");
  },
);

test("the aviation model never tilts", () => {
  // The real terminal is bolted flat to the fuselage and steers electronically,
  // so no part of this model may lean to the boresight. buildDish sends vertices
  // at or above baseVertex through `plant`, which holds them level and turns them
  // in azimuth only — so baseVertex 0 means the whole aircraft stays flat. Any
  // value above 0 would hand that many vertices to `place` and tilt them.
  const mesh = meshForModel("aviation");
  expect(mesh.joint).toBeDefined();
  expect(mesh.joint!.baseVertex).toBe(0);
});

test("only a model that asks moves the camera's closest orbit", () => {
  // The clearance is opt-in rather than derived from size, because size does not
  // separate the two cases: rev2Circular and rev3Rectangular are taller than the
  // camera's floor and want nothing — a mast has no interior to fall into. Any
  // model not asking must report no radius, so its zoom is untouched.
  const survey = {
    boresightAzimuthDeg: 0,
    boresightElevationDeg: 70,
    dishModel: "rev4Standard",
  } as unknown as Parameters<typeof buildDish>[1];

  for (const model of MODELS) {
    const { radius } = buildDish(meshForModel(model), survey, 1);
    if (model === "aviation") {
      // Big enough that it genuinely swallows the eye at the standing 0.45.
      expect(radius, model).toBeGreaterThan(0.45);
    } else {
      expect(radius, `${model} must not touch the camera`).toBe(0);
    }
  }
});

test("the aviation model is wound outward", () => {
  // buildDish takes each triangle's normal from its winding, so a part wound
  // inward lights from the inside and renders at the ambient floor — which is
  // how a mirrored wing came to sit in shadow. Signed volume against the origin
  // is positive for an outward-wound closed body; the bake asserts the same
  // thing, and this guards the data that actually ships.
  for (const model of ["aviation"] as const) {
    const mesh = meshForModel(model);
    const p = new Int16Array(Buffer.from(mesh.positions, "base64").buffer);
    const idx = new Uint16Array(Buffer.from(mesh.indices, "base64").buffer);
    let volume = 0;
    for (let o = 0; o < idx.length; o += 3) {
      const [a, b, c] = [idx[o], idx[o + 1], idx[o + 2]].map((v) => [
        p[v * 3],
        p[v * 3 + 1],
        p[v * 3 + 2],
      ]);
      volume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
    expect(volume, `${model} is wound inward`).toBeGreaterThan(0);
  }
});

test("the unknown kit draws the Standard but refuses to be named one", () => {
  // A dish we can't place still has to render, so it borrows the Standard's body
  // and render. Its name must not: claiming a kit the user doesn't own is worse
  // than admitting we don't know.
  expect(meshForModel("unknown")).toBe(meshForModel("rev4Standard"));
  expect(specForModel("unknown").displayName).toBe("Unknown Model");
  expect(specForModel("unknown").displayName).not.toBe(specForModel("rev4Standard").displayName);
});

test("every model the resolver can return has a mesh and a spec", () => {
  const models = new Set<DishModel>([
    ...TABLE.map(([, model]) => model),
    "performanceGen1",
    "performanceGen2",
    "unknown",
  ]);
  for (const model of models) {
    expect(meshForModel(model), model).toBeTruthy();
    expect(specForModel(model).displayName, model).toBeTruthy();
  }
});
