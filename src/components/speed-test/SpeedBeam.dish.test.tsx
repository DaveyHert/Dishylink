// Every kit the resolver can name has to draw. The panel takes a DishModel and
// asks the art module for a render and two anchors; a model missing from that
// table would throw, or seat its beam somewhere off the hardware, for the one
// user whose dish resolves there and nobody else. So this walks the whole
// DishModel union rather than sampling it.

import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { DishModel } from "../../lib/dishMesh";
import { SpeedBeam } from "./SpeedBeam";

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

/** Where the beam meets the dish, as the scene lays it out. */
function beamFoot(container: HTMLElement): [number, number] {
  const line = container.querySelector("line")!;
  return [Number(line.getAttribute("x1")), Number(line.getAttribute("y1"))];
}

test.each(MODELS)("%s draws its own render, with the beam on its panel", async (model) => {
  const screen = await render(
    <SpeedBeam value={120} mode='download' caption='Download' testActive dishModel={model} />,
  );

  const image = screen.container.querySelector("image")!;
  expect(image.getAttribute("href")).toBeTruthy();

  // The art is seated by its ground anchor, so the box it occupies straddles the
  // ring centre rather than starting at the viewBox origin.
  const x = Number(image.getAttribute("x"));
  const y = Number(image.getAttribute("y"));
  expect(x).toBeGreaterThan(0);
  expect(y).toBeGreaterThan(0);

  // The beam launches from this kit's own panel anchor: a real point, inside the
  // scene, and inside the box the dish is drawn in.
  const [footX, footY] = beamFoot(screen.container);
  expect(footX).toBeGreaterThan(x);
  expect(footX).toBeLessThan(x + 46);
  expect(footY).toBeGreaterThan(y);
  expect(footY).toBeLessThan(y + 46);
});

/** Kits with no art of their own, which draw another kit's render outright.
 *  Aviation borrows the Performance Gen 3 panel it is built from, because at 46
 *  units the speed test wants the terminal rather than the airframe; the unknown
 *  kit borrows the Standard's body, as it does in the dome. First in each group
 *  is the owner. */
const BORROWED_RENDER: DishModel[][] = [
  ["performanceGen3", "aviation"],
  ["rev4Standard", "unknown"],
];

/** Kits sharing a beam anchor while drawing their own art. A borrower inherits
 *  its owner's anchors; beyond those, the two Minis differ only in a side band,
 *  and Performance Gen 1 is the same rectangular panel on the same mast as the
 *  Gen 2 rectangular dish — same hull, so the beam leaves at the same point. */
const SHARED_FOOT: DishModel[][] = [
  ["mini1", "mini2"],
  ["rev3Rectangular", "performanceGen1"],
  ...BORROWED_RENDER,
];

/** One representative per group, dropping the members that defer to the first. */
const representatives = (groups: DishModel[][]) =>
  MODELS.filter((m) => !groups.some((g) => g.slice(1).includes(m)));

test("each body draws its own render, and only the declared kits share one", async () => {
  // A copy-pasted row pointing two kits at one file passes the per-model test
  // above — the render still lands in its own box. Only distinctness catches it,
  // so the sharing that IS intended has to be declared rather than assumed.
  const renderFor = new Map<DishModel, string>();
  const footFor = new Map<DishModel, string>();
  for (const model of MODELS) {
    const screen = await render(
      <SpeedBeam value={null} mode='idle' caption='Ready' dishModel={model} />,
    );
    renderFor.set(model, screen.container.querySelector("image")!.getAttribute("href")!);
    footFor.set(model, String(beamFoot(screen.container)));
  }

  // A borrowed render is only borrowed if the anchors come with it: the same art
  // seated differently would put the beam off the hardware it is drawn on.
  for (const [owner, ...borrowers] of BORROWED_RENDER) {
    for (const model of borrowers) {
      expect(renderFor.get(model), model).toBe(renderFor.get(owner));
      expect(footFor.get(model), model).toBe(footFor.get(owner));
    }
  }
  for (const [owner, ...rest] of SHARED_FOOT) {
    for (const model of rest) expect(footFor.get(model), model).toBe(footFor.get(owner));
  }

  // Every kit that is not declared a borrower must be telling itself apart.
  const ownRender = representatives(BORROWED_RENDER);
  expect(new Set(ownRender.map((m) => renderFor.get(m))).size).toBe(ownRender.length);
  const ownFoot = representatives(SHARED_FOOT);
  expect(new Set(ownFoot.map((m) => footFor.get(m))).size).toBe(ownFoot.length);
});
