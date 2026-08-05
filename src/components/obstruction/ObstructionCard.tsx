// The dashboard's Obstructions card: the dish's view of its own sky, full-bleed.

import { useCallback, useState } from "react";
import { Callout } from "../ui/callout";
import { Loading } from "../ui/loading";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "@core/dishClient";
import { ObstructionDome } from "./ObstructionDome";
import { ObstructionKey, ObstructionStats } from "./ObstructionKey";
import { SkyControl } from "../satellite/SkyControl";
import { DomeIcon } from "../../assets/icons/DomeIcon";
import { PauseIcon } from "../../assets/icons/PauseIcon";
import { useDomeTrim } from "../../hooks/useDomeTrim";
import { setDomeTrimEnabled } from "../../lib/domeTrim";
import type { SkyScene } from "../satellite/skyScene";

interface ObstructionCardProps {
  obstructionMap: DishObstructionMapJson | null;
  obstructionStats?: DishObstructionStatsJson;
  /** Live status — drives the dish model and its real orientation. */
  status: DishStatusJson | null;
  onOpenSatelliteView: () => void;
}

export function ObstructionCard({
  obstructionMap,
  obstructionStats,
  status,
  onOpenSatelliteView,
}: ObstructionCardProps) {
  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  const trimmed = useDomeTrim();
  // The dome drifts on its own; this holds it still for anyone reading the map
  // rather than watching it. Seeded from the scene so a rebuilt scene's button
  // starts honest.
  const [scene, setScene] = useState<SkyScene | null>(null);
  const [rotating, setRotating] = useState(true);
  const handleScene = useCallback((next: SkyScene | null) => {
    setScene(next);
    if (next) setRotating(next.isRotating());
  }, []);
  return (
    <div
      data-theme='dark'
      className='relative row-span-2 col-span-4 min-w-0 max-[1080px]:h-[420px] overflow-hidden rounded-xl bg-page text-foreground'
    >
      <ObstructionDome
        obstructionMap={obstructionMap}
        status={status}
        onSceneChange={handleScene}
      />

      {!obstructionMap?.snr && (
        <div className='absolute inset-0 flex items-center justify-center'>
          <Loading message='Waiting for obstruction data…' />
        </div>
      )}

      {/* Scrims, not solid bars: the sky keeps going behind the chrome, it just
          darkens enough under the text to stay readable. Each is only as tall as
          the block it sits under — the bottom one ran half the card and reached
          95% black, which put a wash over the whole lower dome, the half the
          unmapped skirt fills. */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#000000d9] to-transparent' />
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#000000cc] to-transparent' />

      <div className='pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-[18px] py-4'>
        <span className='text-[16px] font-semibold tracking-[0.005em]'>Obstructions</span>
        {/* The chrome layer lets clicks through to the scene behind it, so each
            control has to claim its own. */}
        <div className='flex items-center gap-3'>
          <span className='pointer-events-auto'>
            <SkyControl
              label={rotating ? "Pause rotation" : "Resume rotation"}
              pressed={!rotating}
              onClick={() => scene && setRotating(scene.toggleRotation())}
            >
              <PauseIcon playing={rotating} />
            </SkyControl>
          </span>
          <span className='pointer-events-auto'>
            <SkyControl
              label={trimmed ? "Show unmapped sky" : "Hide unmapped sky"}
              pressed={trimmed}
              onClick={() => setDomeTrimEnabled(!trimmed)}
            >
              <DomeIcon skirted={trimmed} />
            </SkyControl>
          </span>
          <button
            className='pointer-events-auto cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-(--accent) transition-[color,opacity] duration-120 hover:opacity-75'
            onClick={onOpenSatelliteView}
          >
            Live satellite view ›
          </button>
        </div>
      </div>

      <div className='pointer-events-none absolute inset-x-0 bottom-0 px-[18px] pb-4'>
        <ObstructionKey centred />
        <ObstructionStats obstructionStats={obstructionStats} centred />
        {/* Glass rather than the tinted box it wears on solid cards: over a live
            scene an opaque panel reads as a patch stuck on the sky. Solider than
            the sky view's panels, though — this one sits on the dome itself
            rather than off to the side of it, so the dots behind it would
            otherwise read through the text. */}
        <Callout className='mt-3 border border-[#8b97a824] bg-[#000000b3] backdrop-blur-md'>
          {fractionObstructed < 0.005
            ? "Your Starlink has an unobstructed view of the sky. The map becomes more accurate as the dish collects data."
            : "Obstructed patches cause brief interruptions as satellites pass behind them."}
        </Callout>
      </div>
    </div>
  );
}
