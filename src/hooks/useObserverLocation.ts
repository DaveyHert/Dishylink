import { useMemo, useState } from "react";
import { useAccountLocation } from "./useAccountLocation";
import {
  loadSavedLocation,
  loadLocationCleared,
  saveLocation,
  clearSavedLocation,
} from "../lib/observerLocation";
import type { ObserverLocation } from "../lib/satellites";

interface DishCoordinates {
  lat?: number;
  lon?: number;
  alt?: number;
}

/**
 * Where the dish is, best source first: the dish itself (priority customers),
 * then the app's saved observer, then the account's location.
 */
export function useObserverLocation(dishCoordinates: DishCoordinates | undefined) {
  const [savedObserver, setSavedObserver] = useState<ObserverLocation | null>(loadSavedLocation);
  // Tracked apart from `savedObserver === null`, which cannot tell "never set
  // one" from "cleared it on purpose". Only the former may be filled in
  // automatically.
  const [locationCleared, setLocationCleared] = useState(loadLocationCleared);
  const hasDishGps = dishCoordinates?.lat !== undefined && dishCoordinates?.lon !== undefined;
  const accountObserver = useAccountLocation(
    !hasDishGps && savedObserver === null && !locationCleared,
  );
  const observerLocation = useMemo<ObserverLocation | null>(() => {
    if (dishCoordinates?.lat !== undefined && dishCoordinates?.lon !== undefined) {
      return {
        latitudeDeg: dishCoordinates.lat,
        longitudeDeg: dishCoordinates.lon,
        altitudeM: dishCoordinates.alt ?? 0,
      };
    }
    return savedObserver ?? accountObserver;
  }, [dishCoordinates, savedObserver, accountObserver]);

  const onLocationSaved = (location: ObserverLocation) => {
    saveLocation(location);
    setSavedObserver(location);
    setLocationCleared(false);
  };
  const onClearLocation = () => {
    clearSavedLocation();
    setSavedObserver(null);
    setLocationCleared(true);
  };

  return { observerLocation, onLocationSaved, onClearLocation };
}
