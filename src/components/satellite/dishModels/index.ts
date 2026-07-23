// One converted mesh per model id, so the scene draws the user's actual kit
// rather than a stand-in.
//
// Keyed by `DishModel` from lib/dishMesh — the same ids the alignment card and
// the settings panel resolve with, so the dish you see and the tilt limits you
// are told about can never disagree about which hardware this is.

import type { DishModel } from "../../../lib/dishMesh";
import type { DishModelMesh } from "./types";
import { enterpriseDish } from "./enterprise";
import { flatHpDish } from "./flatHp";
import { hpDish } from "./hp";
import { miniDish } from "./mini";
import { roundDish } from "./round";
import { standard4Dish } from "./standard4";
import { standardActuatedDish } from "./standardActuated";
import { v5Dish } from "./v5";

const MESHES: Record<DishModel, DishModelMesh> = {
  v2: roundDish, // the original circular kit on its mast
  v3: standardActuatedDish, // rectangular panel on a motorised arm
  v4: standard4Dish, // Standard, kickstand, no motor
  v5: v5Dish,
  hp: hpDish, // High Performance, motorised
  flatHp: flatHpDish, // High Performance, flat mount
  hpV4: enterpriseDish, // Enterprise
  mini: miniDish,
};

export function meshForModel(model: DishModel): DishModelMesh {
  return MESHES[model];
}
