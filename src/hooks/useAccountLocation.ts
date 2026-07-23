// The dish's registered service address, as an automatic observer location.
//
// The dish knows its own coordinates perfectly well but answers PermissionDenied
// to consumer plans, so the account is the nearest thing to an automatic answer.
// What it holds is the REGISTERED address: the dish itself for a fixed install,
// but the address the account was opened under for Roam, where the dish travels.
// So it ranks below anything the user set by hand, and stays overridable.
//
// `active` gates the fetch: passed false, no cloud request is made at all, so an
// app that already knows where the dish is never reaches for the network.

import { useMemo } from "react";
import { useCloudAccount } from "./useCloudAccount";
import type { ObserverLocation } from "../lib/satellites";

export function useAccountLocation(active: boolean): ObserverLocation | null {
  const { data } = useCloudAccount(active);
  const geoLocation = data?.serviceLine?.content?.serviceAddress?.geoLocation;
  const latitude = geoLocation?.latitude;
  const longitude = geoLocation?.longitude;
  return useMemo(() => {
    if (!active || latitude === undefined || longitude === undefined) return null;
    return { latitudeDeg: latitude, longitudeDeg: longitude, altitudeM: 0 };
  }, [active, latitude, longitude]);
}
