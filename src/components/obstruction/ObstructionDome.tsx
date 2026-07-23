// The dashboard's obstruction dome: the sky view's WebGL scene, stripped to what
// this card has always offered.
//
// Same engine as the full view, so the two cannot drift into looking like
// different products — but no satellites, no starfield, no zoom and no picking.
// What is left is the survey, the user's dish, and a slow drift you can grab.
//
// Fills its parent rather than taking a size: the card gives the scene its whole
// area and floats its chrome on top, so the sky reaches every edge.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DishObstructionMapJson, DishStatusJson } from "../../lib/dishClient";
import { createSkyScene, type SkyScene } from "../satellite/skyScene";
import { liveSurvey } from "../satellite/skySurvey";

/**
 * Far enough back that the whole dome sits in frame with air around it, which is
 * what gives it scale — the dish reads as a small object under a big sky. Closer
 * in, the dome overflows the frame and the perspective exaggerates until it
 * stops looking like a place. Matches the framing of the Starlink app's own
 * obstruction view.
 */
const CARD_DISTANCE = 3.6;

/**
 * The dish, drawn well above true size. At true scale it is a speck under the
 * dome — correct, and invisible at this size — so the card exaggerates it into
 * something you can recognise, the way the old 2D dome did.
 */
const CARD_DISH_SCALE = 1.5;

export function ObstructionDome({
  obstructionMap,
  status,
}: {
  obstructionMap: DishObstructionMapJson | null;
  status: DishStatusJson | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // State rather than a ref, for the reason spelled out in SatelliteView: an
  // effect that cannot name the scene as a dependency cannot know to push into
  // a scene built in a later commit than its wiring.
  const [scene, setScene] = useState<SkyScene | null>(null);

  const survey = useMemo(() => liveSurvey(obstructionMap, status), [obstructionMap, status]);
  // `survey` is a new object on every status poll, so building on it directly
  // would tear the scene down and stand a new one up about once a second.
  const surveyRef = useRef(survey);
  surveyRef.current = survey;
  const hasSurvey = survey !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const first = surveyRef.current;
    if (!canvas || !first) return;
    const built = createSkyScene(canvas, first, {
      distance: CARD_DISTANCE,
      zoomable: false,
      dishScale: CARD_DISH_SCALE,
    });
    if (!built) return;
    setScene(built);
    return () => {
      built.dispose();
      setScene(null);
    };
  }, [hasSurvey]);

  useEffect(() => {
    if (survey) scene?.setSurvey(survey);
  }, [scene, survey]);

  if (!hasSurvey) return null;

  return (
    <canvas
      ref={canvasRef}
      className='absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing'
    />
  );
}
