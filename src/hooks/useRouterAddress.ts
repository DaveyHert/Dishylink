// Where this host dials the dish and the router, as the window sees it.
//
// The value is the host's, not the window's: the desktop app's recorder dials
// both boxes with no window open, so an address kept here alone would be
// invisible to the thing that needs it most.
//
// One value per window, not per component: the router diagnosis reads it for
// the whole session while the settings row that changes it comes and goes.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { routerAddressHost, type RouterAddress } from "../lib/routerAddressHost";

let addresses: RouterAddress | null = null;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: RouterAddress): void {
  addresses = next;
  for (const listener of listeners) listener();
}

/** Null until the host answers, and forever on hosts that cannot offer the
 *  choice — which is what keeps the settings rows out of a plain browser tab. */
export function useRouterAddressState(): [RouterAddress | null, (next: RouterAddress) => void] {
  const host = routerAddressHost();
  const current = useSyncExternalStore(
    subscribe,
    () => addresses,
    () => null,
  );

  useEffect(() => {
    if (!host || addresses || reading) return;
    reading = host
      .read()
      .then((value) => {
        // A save that landed while this read was in flight is the newer value.
        if (!addresses) publish(value);
      })
      .finally(() => {
        reading = null;
      });
  }, [host]);

  const setAddresses = useCallback((next: RouterAddress) => publish(next), []);
  return [host ? current : null, setAddresses];
}
