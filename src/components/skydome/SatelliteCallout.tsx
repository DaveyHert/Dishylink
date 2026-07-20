// Anchored detail card for a tapped satellite.
//
// The outer div is positioned imperatively by the draw loop every frame (so the
// card tracks its satellite without a React render per frame), which is why the
// ref must land on it and why it starts hidden: `drawDome` is what reveals it,
// after it knows where the satellite actually is on screen.

import { forwardRef } from "react";
import type { SatelliteSky } from "../../lib/satellites";

/** Satellite pill (DTC / serving) — same frame, color set by which one it is. */
const satTag = "rounded border px-[5px] py-px font-mono text-[8.5px] uppercase tracking-[0.08em]";

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
      className='pointer-events-auto absolute z-[6] min-w-[176px] rounded-md border border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)] px-3 pt-[9px] pb-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.25)] backdrop-blur-[6px]'
      style={{ display: "none" }}
    >
      {selected && (
        <>
          <div className='mb-[7px] flex items-center gap-[7px]'>
            <span
              className='font-mono text-[11.5px] font-semibold tracking-[0.04em] tabular-nums'
              style={{ color: selected.isServing ? "var(--chart-warm)" : "var(--satellite)" }}
            >
              {selected.sky.name.replace(/\s*\[DTC\]\s*/, "")}
            </span>
            {/\[DTC\]/.test(selected.sky.name) && (
              <span className={`${satTag} border-[var(--baseline)] text-[var(--ink-secondary)]`}>
                DTC
              </span>
            )}
            {selected.isServing && (
              <span className={`${satTag} border-[var(--chart-warm)] text-[var(--chart-warm)]`}>
                serving
              </span>
            )}
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
