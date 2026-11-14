// Where this host dials the dish, as the window sees it.
//
// Mirrors useRouterAddress: the value belongs to the host, because the desktop
// recorder polls the dish with no window open. One value per window, so the
// empty-first-run hero and the settings row that changes it agree.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { dishAddressHost, type DishAddress } from "../lib/dishAddressHost";

let addresses: DishAddress | null = null;
let saves = 0;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: DishAddress): void {
  addresses = next;
  for (const listener of listeners) listener();
}

/** Null until the host answers, and forever on hosts that cannot offer the
 *  choice — which is what keeps the settings row out of a plain browser tab. */
export function useDishAddressState(): [DishAddress | null, (next: DishAddress) => void] {
  const host = dishAddressHost();
  const current = useSyncExternalStore(
    subscribe,
    () => addresses,
    () => null,
  );

  // Read on every mount, not once: another tab may have changed the stored
  // address since this window last asked.
  useEffect(() => {
    if (!host || reading) return;
    const savesAtStart = saves;
    reading = host
      .read()
      .then((value) => {
        // A save that landed while this read was in flight is the newer value.
        if (saves === savesAtStart) publish(value);
      })
      .finally(() => {
        reading = null;
      });
  }, [host]);

  const setAddresses = useCallback((next: DishAddress) => {
    saves += 1;
    publish(next);
  }, []);
  return [host ? current : null, setAddresses];
}
