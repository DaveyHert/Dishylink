// Every kit the resolver can name has to draw. The panel takes a DishModel and
// asks the art module for a render and two anchors; a model missing from that
// table would throw, or seat its beam somewhere off the hardware, for the one
// user whose dish resolves there and nobody else. So this walks the whole
// DishModel union rather than sampling it.

import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { DishModel } from "../../lib/dishMesh";
import { SpeedBeam } from "./SpeedBeam";

const MODELS: DishModel[] = ["v2", "v3", "v4", "v5", "hp", "flatHp", "hpV4", "mini"];

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

test("every kit draws a different render, from a different beam foot", async () => {
  // Eight entries pointing at seven files, or two kits sharing one guessed beam
  // origin, both pass the per-model test above — each render would still land in
  // its own box. Only distinctness catches a copy-pasted row.
  const renders: string[] = [];
  const feet: string[] = [];
  for (const model of MODELS) {
    const screen = await render(
      <SpeedBeam value={null} mode='idle' caption='Ready' dishModel={model} />,
    );
    renders.push(screen.container.querySelector("image")!.getAttribute("href")!);
    feet.push(String(beamFoot(screen.container)));
  }
  expect(new Set(renders).size).toBe(MODELS.length);
  expect(new Set(feet).size).toBe(MODELS.length);
});
