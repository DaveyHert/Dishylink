// Where this host dials the dish and the router, as the window sees it.
//
// The value is the host's, not the window's: the desktop app's recorder dials
// both boxes with no window open, so an address kept here alone would be
// invisible to the thing that needs it most.

import { useEffect, useState } from "react";
import { routerAddressHost, type RouterAddress } from "../lib/routerAddressHost";

/** Null until the host answers, and forever on hosts that cannot offer the
 *  choice — which is what keeps the settings rows out of a plain browser tab. */
export function useRouterAddressState(): [RouterAddress | null, (next: RouterAddress) => void] {
  const [addresses, setAddresses] = useState<RouterAddress | null>(null);
  const host = routerAddressHost();

  useEffect(() => {
    if (!host) return;
    let active = true;
    void host.read().then((value) => {
      if (active) setAddresses(value);
    });
    return () => {
      active = false;
    };
  }, [host]);

  return [host ? addresses : null, setAddresses];
}
