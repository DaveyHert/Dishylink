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
import type { DishObstructionMapJson, DishStatusJson } from "@core/dishClient";
import { createSkyScene, type SkyScene } from "../satellite/skyScene";
import { liveSurvey } from "../satellite/skySurvey";
import { useDomeTrim } from "../../hooks/useDomeTrim";
import { domeTrimEnabled } from "../../lib/domeTrim";

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
 * something you can recognise at a glance.
 */
const CARD_DISH_SCALE = 1.5;

export function ObstructionDome({
  obstructionMap,
  status,
  onSceneChange,
}: {
  obstructionMap: DishObstructionMapJson | null;
  status: DishStatusJson | null;
  /** Hands the scene up so the card's chrome can drive it — the controls sit in
   *  the card, over the canvas, but the scene is built down here. */
  onSceneChange?: (scene: SkyScene | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // State rather than a ref, for the reason spelled out in SatelliteView: the
  // scene is built inside an effect, so it does not exist on the first render.
  // Effects that push into it have to re-run once it does, and only naming it as
  // a dependency — which a ref cannot be — makes that happen.
  const [scene, setScene] = useState<SkyScene | null>(null);
  const trimmed = useDomeTrim();

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
      trimUnmapped: domeTrimEnabled(),
    });
    if (!built) return;
    setScene(built);
    return () => {
      built.dispose();
      setScene(null);
    };
  }, [hasSurvey]);

  useEffect(() => {
    onSceneChange?.(scene);
  }, [scene, onSceneChange]);

  useEffect(() => {
    if (survey) scene?.setSurvey(survey);
  }, [scene, survey]);

  // The choice is shared, so this follows whichever surface set it — the card's
  // own control or the sky view's — and the two never show different domes.
  useEffect(() => {
    scene?.setTrimUnmapped(trimmed);
  }, [scene, trimmed]);

  if (!hasSurvey) return null;

  return (
    <canvas
      ref={canvasRef}
      className='absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing'
    />
  );
}
