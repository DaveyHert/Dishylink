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
import rev2Circular from "../assets/dishes/rev2Circular.png";
import rev3Rectangular from "../assets/dishes/rev3Rectangular.png";
import rev4Standard from "../assets/dishes/rev4Standard.png";
import rev5Standard from "../assets/dishes/rev5Standard.png";
import performanceGen1 from "../assets/dishes/performanceGen1.png";
import performanceGen2 from "../assets/dishes/performanceGen2.png";
import performanceGen3 from "../assets/dishes/performanceGen3.png";
import mini1 from "../assets/dishes/mini1.png";
import mini2 from "../assets/dishes/mini2.png";

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
  rev2Circular: {
    pngSrc: rev2Circular,
    groundAnchor: [0.5, 0.7793],
    beamExitAnchor: [0.5305, 0.3242],
  },
  rev3Rectangular: {
    pngSrc: rev3Rectangular,
    groundAnchor: [0.5, 0.7614],
    beamExitAnchor: [0.5251, 0.3327],
  },
  rev4Standard: {
    pngSrc: rev4Standard,
    groundAnchor: [0.5, 0.6571],
    beamExitAnchor: [0.5075, 0.4863],
  },
  rev5Standard: {
    pngSrc: rev5Standard,
    groundAnchor: [0.5, 0.6558],
    beamExitAnchor: [0.5158, 0.4766],
  },
  performanceGen1: {
    pngSrc: performanceGen1,
    groundAnchor: [0.5, 0.7614],
    beamExitAnchor: [0.5251, 0.3327],
  },
  performanceGen2: {
    pngSrc: performanceGen2,
    groundAnchor: [0.5, 0.6602],
    beamExitAnchor: [0.5075, 0.4819],
  },
  performanceGen3: {
    pngSrc: performanceGen3,
    groundAnchor: [0.5, 0.6563],
    beamExitAnchor: [0.4991, 0.5017],
  },
  // No aviation render yet. It borrows the Performance Gen 3 panel it is built
  // from — at 46 units the speed test wants the terminal, not the airframe.
  aviation: {
    pngSrc: performanceGen3,
    groundAnchor: [0.5, 0.6563],
    beamExitAnchor: [0.4991, 0.5017],
  },
  mini1: { pngSrc: mini1, groundAnchor: [0.5, 0.6618], beamExitAnchor: [0.5165, 0.4699] },
  mini2: { pngSrc: mini2, groundAnchor: [0.5, 0.6618], beamExitAnchor: [0.5165, 0.4699] },
  // Borrows the Standard's render, as the dome borrows its body — the speed test
  // still needs a dish to launch the beam from.
  unknown: { pngSrc: rev4Standard, groundAnchor: [0.5, 0.6571], beamExitAnchor: [0.5075, 0.4863] },
};

/** Named to match `dishModelFor(status)` in dishMesh, the resolver that produces
 *  the id this takes. */
export function dishPngArtFor(model: DishModel): DishPngArt {
  return PNG_ART[model];
}
