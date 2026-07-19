// One-time observer-location setup for satellite tracking. Needed because
// SpaceX removed local-API GPS (get_location) for consumer plans in May 2026
// — the dish answers PermissionDenied on Residential regardless of any app
// toggle. Three paths, most to least accurate: paste exact coordinates,
// browser geolocation (often unavailable on desktop Macs — no GPS chip),
// or city-level IP lookup.

import { useState } from "react";
import type { ObserverLocation } from "../lib/satellites";
import { requestBrowserLocation, requestIpLocation, parseCoordinateText } from "../lib/observerLocation";

const actionButton =
  "cursor-pointer rounded-sm border-0 bg-[color-mix(in_srgb,var(--ink)_10%,var(--surface))] font-sans text-[12.5px] font-semibold text-foreground";
const sourceButton = `${actionButton} flex-1 py-[9px] [transition:background_120ms_ease] enabled:hover:bg-[color-mix(in_srgb,var(--ink)_16%,var(--surface))] disabled:cursor-default disabled:opacity-50`;

export function LocationSetup({ onLocationSaved }: { onLocationSaved: (location: ObserverLocation) => void }) {
  const [coordinateText, setCoordinateText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busySource, setBusySource] = useState<"device" | "ip" | null>(null);

  const submitPasted = () => {
    const parsedLocation = parseCoordinateText(coordinateText);
    if (!parsedLocation) {
      setErrorText("Couldn't read that — paste as “6.5244, 3.3792” (latitude, longitude).");
      return;
    }
    onLocationSaved(parsedLocation);
  };

  const useBrowserLocation = () => {
    setBusySource("device");
    setErrorText(null);
    requestBrowserLocation()
      .then(onLocationSaved)
      .catch(() =>
        setErrorText(
          "This device can't resolve its position (desktop Macs need Location Services enabled for the browser, and Wi-Fi positioning may not cover your area). Try the IP option or paste coordinates.",
        ),
      )
      .finally(() => setBusySource(null));
  };

  const useIpLocation = () => {
    setBusySource("ip");
    setErrorText(null);
    requestIpLocation()
      .then(onLocationSaved)
      .catch(() => setErrorText("IP lookup failed — paste coordinates instead."))
      .finally(() => setBusySource(null));
  };

  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-lg bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] px-[13px] py-3">
      <p className="text-[12.5px] leading-[1.5] text-[var(--ink-secondary)]">
        Live satellites need your dish's coordinates — SpaceX no longer exposes GPS to consumer plans over
        the local API. Tip: long-press your home in Google Maps, or open the iPhone <strong>Compass</strong>{" "}
        app, and paste what it shows.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="text"
          placeholder="6.5244, 3.3792"
          value={coordinateText}
          onChange={(changeEvent) => setCoordinateText(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Enter") submitPasted();
          }}
          aria-label="Latitude, longitude"
          className="min-w-0 flex-1 rounded-sm border border-[var(--baseline)] bg-card px-2.5 py-[7px] font-mono text-[12px] text-foreground focus:border-[var(--ink)] focus:outline-none"
        />
        <button onClick={submitPasted} className={`${actionButton} px-4`}>
          Save
        </button>
      </div>
      <div className="flex gap-2">
        <button onClick={useBrowserLocation} disabled={busySource !== null} className={sourceButton}>
          {busySource === "device" ? "Locating…" : "Use this device's location"}
        </button>
        <button onClick={useIpLocation} disabled={busySource !== null} className={sourceButton}>
          {busySource === "ip" ? "Looking up…" : "Approximate from IP"}
        </button>
      </div>
      {errorText && <div className="text-[12px] text-[var(--status-critical)]">{errorText}</div>}
    </div>
  );
}
