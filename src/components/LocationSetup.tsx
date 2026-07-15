// One-time observer-location setup for satellite tracking. Needed because
// SpaceX removed local-API GPS (get_location) for consumer plans in May 2026
// — the dish answers PermissionDenied on Residential regardless of any app
// toggle. Three paths, most to least accurate: paste exact coordinates,
// browser geolocation (often unavailable on desktop Macs — no GPS chip),
// or city-level IP lookup.

import { useState } from "react";
import type { ObserverLocation } from "../lib/satellites";
import { requestBrowserLocation, requestIpLocation, parseCoordinateText } from "../lib/observerLocation";

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
    <div className="location-setup">
      <p>
        Live satellites need your dish's coordinates — SpaceX no longer exposes GPS to consumer plans over
        the local API. Tip: long-press your home in Google Maps, or open the iPhone <strong>Compass</strong>{" "}
        app, and paste what it shows.
      </p>
      <div className="location-manual">
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
        />
        <button onClick={submitPasted}>Save</button>
      </div>
      <div className="location-buttons">
        <button onClick={useBrowserLocation} disabled={busySource !== null}>
          {busySource === "device" ? "Locating…" : "Use this device's location"}
        </button>
        <button onClick={useIpLocation} disabled={busySource !== null}>
          {busySource === "ip" ? "Looking up…" : "Approximate from IP"}
        </button>
      </div>
      {errorText && <div className="location-error">{errorText}</div>}
    </div>
  );
}
