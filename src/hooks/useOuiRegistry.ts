import { useEffect, useSyncExternalStore } from "react";
import { ensureOuiLoaded, isOuiRegistryLoaded, subscribeToOuiRegistry } from "../lib/macVendor";

/** Loads the vendor registry once per session and re-renders the caller when it
 *  lands, so a MAC that resolved to nothing on first paint gets its brand. */
export function useOuiRegistry(): boolean {
  useEffect(() => {
    void ensureOuiLoaded();
  }, []);
  return useSyncExternalStore(subscribeToOuiRegistry, isOuiRegistryLoaded);
}
