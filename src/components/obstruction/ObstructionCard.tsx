// The dashboard's Obstructions card: the dish's view of its own sky, full-bleed.
//
// Not a SectionCard — that shell pads its content, which would box the scene
// into a panel inside a panel. Here the dome IS the card, edge to edge, and the
// title, key and figures float on top over gradient scrims. The shell classes
// below mirror SectionCard's so it still sits in the dashboard grid identically.
//
// Pinned to the dark token set for the same reason the sky view is: the scene
// clears and fogs to black, so it reads as a night sky whatever theme the
// dashboard around it is in — and the chrome above has to be legible on that.

import { Callout } from "../ui/callout";
import { Loading } from "../ui/loading";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "../../lib/dishClient";
import { ObstructionDome } from "./ObstructionDome";
import { ObstructionKey, ObstructionStats } from "./ObstructionKey";

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
  return (
    <div
      data-theme='dark'
      className='relative row-span-2 col-span-4 min-w-0 overflow-hidden rounded-xl bg-[var(--page)] text-foreground'
    >
      <ObstructionDome obstructionMap={obstructionMap} status={status} />

      {!obstructionMap?.snr && (
        <div className='absolute inset-0 flex items-center justify-center'>
          <Loading message='Waiting for obstruction data…' />
        </div>
      )}

      {/* Scrims, not solid bars: the sky keeps going behind the chrome, it just
          darkens enough under the text to stay readable. */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#000000d9] to-transparent' />
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#000000f2] via-[#000000d9] to-transparent' />

      <div className='pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-[18px] py-4'>
        <span className='text-[16px] font-semibold tracking-[0.005em]'>Obstructions</span>
        <button
          className='pointer-events-auto cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-[var(--accent)] transition-[color,opacity] duration-[120ms] hover:opacity-75'
          onClick={onOpenSatelliteView}
        >
          Satellite view ›
        </button>
      </div>

      <div className='pointer-events-none absolute inset-x-0 bottom-0 px-[18px] pb-4'>
        <ObstructionKey centred />
        <ObstructionStats obstructionStats={obstructionStats} centred />
        {/* Glass rather than the tinted box it wears on solid cards: over a live
            scene an opaque panel reads as a patch stuck on the sky. */}
        <Callout className='mt-3 border border-[#8b97a824] bg-[#00000073] backdrop-blur-md'>
          {fractionObstructed < 0.005
            ? "Your Starlink has an unobstructed view of the sky. The map becomes more accurate as the dish collects data."
            : "Obstructed patches cause brief interruptions as satellites pass behind them."}
        </Callout>
      </div>
    </div>
  );
}
