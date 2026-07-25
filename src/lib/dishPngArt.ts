// The flat dish art: one baked PNG render per kit, with the two points needed to
// place it. This is the 2D illustration used by the speed test — not the
// procedural 3D geometry in dishMesh, which is what the sky view draws.
//
// The renders live in `src/assets/dishes/`, and this table is the only record of
// where each one's ground and panel sit. They were rendered once from that same
// dish geometry, and the renderer that produced them has been removed, so there
// is nothing to re-run: a change means a new render dropped in and its two
// anchors measured to match it.
//
// Both anchors are normalised 0..1 of the image, which makes them independent of
// the size the art is drawn at.

import type { DishModel } from "./dishMesh";
import v2 from "../assets/dishes/v2.png";
import v3 from "../assets/dishes/v3.png";
import v4 from "../assets/dishes/v4.png";
import v5 from "../assets/dishes/v5.png";
import hp from "../assets/dishes/hp.png";
import flatHp from "../assets/dishes/flatHp.png";
import hpV4 from "../assets/dishes/hpV4.png";
import mini from "../assets/dishes/mini.png";

export interface DishPngArt {
  /** The render's bundled URL. */
  pngSrc: string;
  /** The ground under the dish's centre — seats the art on the horizon rings
   *  instead of floating it at whatever the image happens to be padded to. */
  groundAnchor: [number, number];
  /** Where the beam leaves the panel face, so it starts on the hardware. A Mini's
   *  panel sits nothing like a mast-mounted High Performance kit's, which is why
   *  this is per kit. */
  beamExitAnchor: [number, number];
}

const PNG_ART: Record<DishModel, DishPngArt> = {
  v2: { pngSrc: v2, groundAnchor: [0.5, 0.7793], beamExitAnchor: [0.5305, 0.3242] },
  v3: { pngSrc: v3, groundAnchor: [0.5, 0.7614], beamExitAnchor: [0.5251, 0.3327] },
  v4: { pngSrc: v4, groundAnchor: [0.5, 0.6571], beamExitAnchor: [0.5075, 0.4863] },
  v5: { pngSrc: v5, groundAnchor: [0.5, 0.6558], beamExitAnchor: [0.5158, 0.4766] },
  hp: { pngSrc: hp, groundAnchor: [0.5, 0.6602], beamExitAnchor: [0.5075, 0.4819] },
  flatHp: { pngSrc: flatHp, groundAnchor: [0.5, 0.6563], beamExitAnchor: [0.4991, 0.5017] },
  hpV4: { pngSrc: hpV4, groundAnchor: [0.5, 0.6572], beamExitAnchor: [0.5077, 0.486] },
  // One render serves both Minis: the side band that separates them in the 3D
  // dome is not resolvable at the 46-unit size the speed test draws this at.
  mini1: { pngSrc: mini, groundAnchor: [0.5, 0.6618], beamExitAnchor: [0.5165, 0.4699] },
  mini2: { pngSrc: mini, groundAnchor: [0.5, 0.6618], beamExitAnchor: [0.5165, 0.4699] },
};

/** Named to match `dishModelFor(status)` in dishMesh, the resolver that produces
 *  the id this takes. */
export function dishPngArtFor(model: DishModel): DishPngArt {
  return PNG_ART[model];
}
