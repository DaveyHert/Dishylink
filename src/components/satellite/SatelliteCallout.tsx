// Anchored detail card for a tapped satellite.
//
// The outer div is positioned imperatively by the draw loop every frame (so the
// card tracks its satellite without a React render per frame), which is why the
// ref must land on it and why it starts hidden: `drawDome` is what reveals it,
// after it knows where the satellite actually is on screen.

import { forwardRef } from "react";
import type { SatelliteSky } from "../../lib/satellites";
import { Badge } from "../ui/badge";

export interface SelectedSatellite {
  sky: SatelliteSky;
  isServing: boolean;
}

export const SatelliteCallout = forwardRef<
  HTMLDivElement,
  { selected: SelectedSatellite | null; onClose: () => void }
>(function SatelliteCallout({ selected, onClose }, ref) {
  return (
    <div
      ref={ref}
      // Same glass as the panels over the sky, so a tapped satellite's card
      // belongs to the scene rather than sitting on it.
      className='pointer-events-auto absolute z-[6] min-w-[176px] rounded-md border border-[#28282896] bg-[#00000094] px-3 pt-[9px] pb-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.25)]'
      style={{ display: "none" }}
    >
      {selected && (
        <>
          <div className='mb-[7px] flex items-center gap-[7px]'>
            {/* Amber is the view's word for "serving", so the name's own colour
                says which this is — no separate tag needed. */}
            <span
              className='font-mono text-[11.5px] font-semibold tracking-[0.04em] tabular-nums'
              style={{ color: selected.isServing ? "var(--chart-warm)" : "var(--ink)" }}
            >
              {selected.sky.name.replace(/\s*\[DTC\]\s*/, "")}
            </span>
            {/\[DTC\]/.test(selected.sky.name) && <Badge variant='tag'>DTC</Badge>}
            <button
              className='ml-auto cursor-pointer border-0 bg-transparent pl-1 text-[15px] leading-none text-muted-foreground hover:text-foreground'
              aria-label='Close satellite details'
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className='grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-[3px] font-mono text-[11px] tabular-nums [&>span:nth-child(odd)]:text-muted-foreground [&>span:nth-child(even)]:text-right'>
            <span>elevation</span>
            <span>{selected.sky.elevationDeg.toFixed(1)}°</span>
            <span>azimuth</span>
            <span>{((selected.sky.azimuthDeg + 360) % 360).toFixed(1)}°</span>
            <span>altitude</span>
            <span>
              {selected.sky.altitudeKm !== undefined
                ? `${selected.sky.altitudeKm.toFixed(0)} km`
                : "—"}
            </span>
            <span>distance</span>
            <span>{selected.sky.rangeKm.toFixed(0)} km</span>
            <span>speed</span>
            <span>
              {selected.sky.speedKmS !== undefined
                ? `${selected.sky.speedKmS.toFixed(1)} km/s`
                : "—"}
            </span>
          </div>
        </>
      )}
    </div>
  );
});
