// One converted mesh per model id, so the scene draws the user's actual kit
// rather than a stand-in.
//
// Keyed by `DishModel` from lib/dishMesh — the same ids the alignment card and
// the settings panel resolve with, so the dish you see and the tilt limits you
// are told about can never disagree about which hardware this is.

import type { DishModel } from "../../../lib/dishMesh";
import type { DishModelMesh } from "./types";
import { performanceGen3Dish } from "./performanceGen3";
import { hpDish } from "./hp";
import { mini1Dish } from "./mini1";
import { mini2Dish } from "./mini2";
import { roundDish } from "./round";
import { standard4Dish } from "./standard4";
import { standardActuatedDish } from "./standardActuated";
import { v5Dish } from "./v5";

const MESHES: Record<DishModel, DishModelMesh> = {
  v2: roundDish, // the original circular kit on its mast
  v3: standardActuatedDish, // rectangular panel on a motorised arm
  v4: standard4Dish, // Standard, kickstand, no motor — and Enterprise, the same terminal
  v5: v5Dish,
  hp: hpDish, // High Performance, motorised
  // Both ids reached by an HP-family string land on the same panel: `flatHp` from
  // hp*/rev_hp1_* without actuators, `hpV4` from rev4_hp_prod*, which IS Gen 3.
  flatHp: performanceGen3Dish,
  hpV4: performanceGen3Dish,
  mini1: mini1Dish, // dark side band
  mini2: mini2Dish, // white throughout
};

export function meshForModel(model: DishModel): DishModelMesh {
  return MESHES[model];
}
