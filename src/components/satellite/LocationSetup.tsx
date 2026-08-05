// One-time observer-location setup for satellite tracking. Needed because
// SpaceX removed local-API GPS (get_location) for consumer plans in May 2026
// — the dish answers PermissionDenied on Residential regardless of any app
// toggle. Three paths, most to least accurate: paste exact coordinates,
// browser geolocation (often unavailable on desktop Macs — no GPS chip),
// or city-level IP lookup.

import { useState } from "react";
import type { ObserverLocation } from "../../lib/satellites";
import {
  requestBrowserLocation,
  requestIpLocation,
  parseCoordinateText,
} from "../../lib/observerLocation";
import { GpsIcon } from "../../assets/icons/GpsIcon";
import { MapPinIcon } from "../../assets/icons/MapPinIcon";

/** The primary action: the ink fill the rest of the app gives its action buttons. */
const saveButton =
  "cursor-pointer rounded-full border-0 bg-primary px-5 py-[7px] font-sans text-[12.5px] " +
  "font-semibold text-primary-foreground transition-opacity duration-[120ms] enabled:hover:opacity-85";
/** The two fallbacks are secondary to pasting coordinates, so they carry no
 *  button chrome at all — an icon and its label, over the glass. */
const sourceButton =
  "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-sans " +
  "text-[12.5px] font-semibold text-ink-secondary transition-colors duration-[120ms] " +
  "enabled:hover:text-foreground disabled:cursor-default disabled:opacity-50";

export function LocationSetup({
  onLocationSaved,
}: {
  onLocationSaved: (location: ObserverLocation) => void;
}) {
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
    // Sunk a shade darker than the panel it sits in, and the one surface here
    // that blurs: it carries an input and its instructions, so the sky moving
    // behind it has to be pushed out of focus rather than read through.
    <div className='mt-3 flex flex-col gap-2.5 rounded-lg border border-[#8b97a824] bg-[#00000073] px-[13px] py-3 backdrop-blur-xl'>
      <p className='text-[12.5px] leading-[1.5] text-ink-secondary'>
        To show the satellites passing over you, we need to know where your dish is. Tip: long-press
        your home in Google Maps, or open the iPhone <strong>Compass</strong> app, and paste what it
        shows.
      </p>
      <div className='flex gap-2'>
        <input
          type='text'
          inputMode='text'
          placeholder='6.5244, 3.3792'
          value={coordinateText}
          onChange={(changeEvent) => setCoordinateText(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Enter") submitPasted();
          }}
          aria-label='Latitude, longitude'
          className='min-w-0 flex-1 rounded-full border border-[color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3.5 py-[7px] font-mono text-[12px] text-foreground placeholder:text-ink-secondary focus:border-[color-mix(in_srgb,var(--ink)_40%,transparent)] focus:outline-none'
        />
        <button onClick={submitPasted} className={saveButton}>
          Save
        </button>
      </div>
      <div className='flex flex-wrap gap-x-5 gap-y-2'>
        <button
          onClick={useBrowserLocation}
          disabled={busySource !== null}
          className={sourceButton}
        >
          <GpsIcon />
          {busySource === "device" ? "Locating…" : "Use this device location"}
        </button>
        <button onClick={useIpLocation} disabled={busySource !== null} className={sourceButton}>
          <MapPinIcon />
          {busySource === "ip" ? "Looking up…" : "Approximate from IP"}
        </button>
      </div>
      {errorText && <div className='text-[12px] text-status-critical'>{errorText}</div>}
    </div>
  );
}
