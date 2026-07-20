// Draggable 3D sky dome, in the style of the Starlink app's Obstructions
// view, extended well past it:
//   - the dish's 123×123 obstruction grid as a hemisphere of dots
//     (ink = clear, red = obstructed, faint gray = unmapped)
//   - live Starlink satellites crossing the sky (SGP4 from SpaceX ephemeris),
//     with motion trails and a beam to the likely serving satellite
//   - a time-lapse scrubber over hourly obstruction snapshots
// Hand-rolled orthographic projection on 2D canvas; drag to orbit and tilt.
//
// Two surfaces share one canvas: the compact Obstructions card on the dashboard
// and the immersive satellite sheet. Both drive the same `useSkyDomeCanvas`, so
// what is left here is only what differs — layout, and which extras are shown.

import { Callout } from "../ui/callout";
import { SectionCard } from "../ui/section-card";
import { Loading } from "../ui/loading";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "../../lib/dishClient";
import type { SatelliteFeed } from "../../hooks/useSatellites";
import type { ObserverLocation } from "../../lib/satellites";
import { LocationSetup } from "./LocationSetup";
import { ObstructionTimeLapse } from "./ObstructionTimeLapse";
import { SatelliteCallout } from "./SatelliteCallout";
import { SkyLegend, SkyStats } from "./SkyLegend";
import { IMMERSIVE_CANVAS_SIZE, STANDARD_CANVAS_SIZE } from "./domeGeometry";
import { useSkyDomeCanvas } from "./useSkyDomeCanvas";

interface SkyDomeProps {
  obstructionMap: DishObstructionMapJson | null;
  obstructionStats?: DishObstructionStatsJson;
  /** Live status — drives the dish mesh model + its real orientation. */
  status: DishStatusJson | null;
  theme: "light" | "dark";
  satellites: SatelliteFeed;
  observerLocation: ObserverLocation | null;
  onLocationSaved: (location: ObserverLocation) => void;
  onClearLocation: () => void;
  /** "standard" = compact obstructions card; "immersive" = full satellite view in a sheet. */
  variant?: "standard" | "immersive";
  onOpenImmersive?: () => void;
  /** Immersive only: sub-text under the sheet title, sharing the row with the site line. */
  caption?: string;
}

export function SkyDome({
  obstructionMap,
  obstructionStats,
  status,
  theme,
  satellites,
  observerLocation,
  onLocationSaved,
  onClearLocation,
  variant = "standard",
  onOpenImmersive,
  caption,
}: SkyDomeProps) {
  const isImmersive = variant === "immersive";
  const canvasSize = isImmersive ? IMMERSIVE_CANVAS_SIZE : STANDARD_CANVAS_SIZE;
  const dome = useSkyDomeCanvas({
    obstructionMap,
    status,
    theme,
    satellites,
    isImmersive,
    canvasSize,
  });

  const domeCanvas =
    obstructionMap?.snr || dome.isViewingHistory ? (
      <canvas
        ref={dome.canvasRef}
        className='max-w-full cursor-grab touch-none active:cursor-grabbing'
        style={{ width: canvasSize, height: canvasSize }}
        {...dome.canvasHandlers}
      />
    ) : (
      <Loading message='Waiting for obstruction data…' />
    );

  if (!isImmersive) {
    const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
    return (
      <SectionCard
        title='Obstructions'
        className='row-span-2 col-span-4'
        headerAction={
          <button
            className='cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-[var(--accent)] transition-[color,opacity] duration-[120ms] hover:opacity-75'
            onClick={onOpenImmersive}
          >
            Satellite view ›
          </button>
        }
      >
        <div className='relative flex justify-center pt-0.5 pb-2'>{domeCanvas}</div>
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

  return (
    <div>
      {(caption || (satellites.feedState === "active" && observerLocation)) && (
        // Caption and site line are ends of one row: the caption is the sheet's
        // sub-title, so it must sit on the title's baseline row, not above it.
        <div className='flex items-center justify-between gap-3'>
          <span className='text-[11.5px] font-medium text-muted-foreground'>{caption}</span>
          {satellites.feedState === "active" && observerLocation && (
            <span className='flex shrink-0 items-center gap-2'>
              <span className='text-[11.5px] font-medium text-muted-foreground'>
                site {observerLocation.latitudeDeg.toFixed(4)},{" "}
                {observerLocation.longitudeDeg.toFixed(4)}
              </span>
              <button
                className='cursor-pointer border-0 bg-transparent p-0 font-sans text-[11.5px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground'
                onClick={onClearLocation}
              >
                change
              </button>
            </span>
          )}
        </div>
      )}
      <div className='relative flex justify-center pt-2 pb-3'>
        {domeCanvas}
        <SatelliteCallout
          ref={dome.calloutRef}
          selected={dome.selectedSatellite}
          onClose={dome.clearSelection}
        />
      </div>
      <div className='pt-0.5 pb-1.5 text-center text-[12px] font-medium text-muted-foreground opacity-70'>
        {dome.isViewingHistory ? "time-lapse" : "drag to orbit · tap a satellite for details"}
      </div>
      {dome.snapshots.length >= 2 && (
        <ObstructionTimeLapse
          snapshots={dome.snapshots}
          scrubIndex={dome.scrubIndex}
          onScrub={dome.setScrubIndex}
        />
      )}
      <SkyLegend withSatellites />
      <SkyStats obstructionStats={obstructionStats} satellites={satellites} />
      <ImmersiveNote
        satellites={satellites}
        obstructionStats={obstructionStats}
        isViewingHistory={dome.isViewingHistory}
        snapshotTakenAtMs={
          dome.isViewingHistory && dome.scrubIndex !== null
            ? dome.snapshots[dome.scrubIndex].takenAtMs
            : undefined
        }
        onLocationSaved={onLocationSaved}
      />
    </div>
  );
}

/**
 * The note under the immersive dome reports three different KINDS of thing —
 * advice, a pending fetch, and a failure. They used to be one string in one ⓘ box,
 * so "couldn't load ephemerides" was dressed as a helpful tip.
 */
function ImmersiveNote({
  satellites,
  obstructionStats,
  isViewingHistory,
  snapshotTakenAtMs,
  onLocationSaved,
}: {
  satellites: SatelliteFeed;
  obstructionStats?: DishObstructionStatsJson;
  isViewingHistory: boolean;
  snapshotTakenAtMs?: number;
  onLocationSaved: (location: ObserverLocation) => void;
}) {
  const { feedState } = satellites;
  if (feedState === "location-needed" && !isViewingHistory) {
    return <LocationSetup onLocationSaved={onLocationSaved} />;
  }
  if (snapshotTakenAtMs !== undefined) {
    return (
      <Callout className='mt-3'>
        Viewing the obstruction map as of {new Date(snapshotTakenAtMs).toLocaleString()}.
      </Callout>
    );
  }
  if (feedState === "loading") {
    return <Loading message="Loading SpaceX's published constellation ephemerides…" />;
  }
  if (feedState === "error") {
    return (
      <Callout className='mt-3' tone='error'>
        Couldn't load satellite ephemerides — check the internet connection and reload.
      </Callout>
    );
  }
  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  return (
    <Callout className='mt-3'>
      {fractionObstructed < 0.005
        ? "Your Starlink has an unobstructed view of the sky. The orange beam marks the best unobstructed satellite."
        : "Obstructed patches cause brief interruptions as satellites pass behind them. The orange beam marks the best unobstructed satellite."}
    </Callout>
  );
}
