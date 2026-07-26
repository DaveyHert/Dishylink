// One converted mesh per model id, so the scene draws the user's actual kit
// rather than a stand-in.
//
// Keyed by `DishModel` from lib/dishMesh — the same ids the alignment card and
// the settings panel resolve with, so the dish you see and the tilt limits you
// are told about can never disagree about which hardware this is.

import type { DishModel } from "../../../lib/dishMesh";
import type { DishModelMesh } from "./types";
import { rev2CircularDish } from "./rev2Circular";
import { rev3RectangularDish } from "./rev3Rectangular";
import { rev4StandardDish } from "./rev4Standard";
import { rev5StandardDish } from "./rev5Standard";
import { performanceGen1Dish } from "./performanceGen1";
import { performanceGen2Dish } from "./performanceGen2";
import { performanceGen3Dish } from "./performanceGen3";
import { aviationDish } from "./aviation";
import { mini1Dish } from "./mini1";
import { mini2Dish } from "./mini2";

const MESHES: Record<DishModel, DishModelMesh> = {
  rev2Circular: rev2CircularDish, // the original circular kit on its mast
  rev3Rectangular: rev3RectangularDish, // rectangular panel on a motorised arm
  rev4Standard: rev4StandardDish, // Standard, kickstand, no motor — and Enterprise, the same terminal
  rev5Standard: rev5StandardDish,
  performanceGen1: performanceGen1Dish, // rectangular panel on a mast
  performanceGen2: performanceGen2Dish, // flat panel on the low wedge mount
  performanceGen3: performanceGen3Dish, // mount-less flat panel
  aviation: aviationDish, // the terminal on the aircraft, hinged so only it aims
  mini1: mini1Dish, // grey side band
  mini2: mini2Dish, // all white
  // Hardware the resolver couldn't name still has to draw something, in the dome
  // and everywhere else, so it borrows the Standard's body.
  unknown: rev4StandardDish,
};

export function meshForModel(model: DishModel): DishModelMesh {
  return MESHES[model];
}
