// The dashboard's compact Obstructions card: the dish's 123×123 obstruction grid
// drawn as a hemisphere of dots (ink = clear, red = obstructed, faint gray =
// unmapped), on a hand-rolled orthographic projection over a 2D canvas. Drag to
// orbit and tilt. Live satellites, the serving beam and the time-lapse scrubber
// belong to the full-page SatelliteView, which its header links out to.

import { Callout } from "../ui/callout";
import { SectionCard } from "../ui/section-card";
import { Loading } from "../ui/loading";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "../../lib/dishClient";
import { SkyLegend, SkyStats } from "./SkyLegend";
import { STANDARD_CANVAS_SIZE } from "./domeGeometry";
import { useSkyDomeCanvas } from "./useSkyDomeCanvas";

interface SkyDomeProps {
  obstructionMap: DishObstructionMapJson | null;
  obstructionStats?: DishObstructionStatsJson;
  /** Live status — drives the dish mesh model + its real orientation. */
  status: DishStatusJson | null;
  theme: "light" | "dark";
  onOpenSatelliteView: () => void;
}

export function SkyDome({
  obstructionMap,
  obstructionStats,
  status,
  theme,
  onOpenSatelliteView,
}: SkyDomeProps) {
  const dome = useSkyDomeCanvas({
    obstructionMap,
    status,
    theme,
    canvasSize: STANDARD_CANVAS_SIZE,
  });

  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  return (
    <SectionCard
      title='Obstructions'
      className='row-span-2 col-span-4'
      headerAction={
        <button
          className='cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-[var(--accent)] transition-[color,opacity] duration-[120ms] hover:opacity-75'
          onClick={onOpenSatelliteView}
        >
          Satellite view ›
        </button>
      }
    >
      <div className='relative flex justify-center pt-0.5 pb-2'>
        {obstructionMap?.snr ? (
          <canvas
            ref={dome.canvasRef}
            className='max-w-full cursor-grab touch-none active:cursor-grabbing'
            style={{ width: STANDARD_CANVAS_SIZE, height: STANDARD_CANVAS_SIZE }}
            {...dome.canvasHandlers}
          />
        ) : (
          <Loading message='Waiting for obstruction data…' />
        )}
      </div>
      <SkyLegend />
      <SkyStats obstructionStats={obstructionStats} />
      <Callout className='mt-3'>
        {fractionObstructed < 0.005
          ? "Your Starlink has an unobstructed view of the sky. The map becomes more accurate as the dish collects data."
          : "Obstructed patches cause brief interruptions as satellites pass behind them."}
      </Callout>
    </SectionCard>
  );
}
