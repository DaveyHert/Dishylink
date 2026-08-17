// Records which roster entry this machine is, while the LAN can still prove it.
// Off the router's network there is no address to match on, so the self-pause
// refusal in the host process depends on that answer having been kept.

import { useEffect, useRef } from "react";
import type { WifiClientJson } from "@core/dishClient";
import { matchesSelfByAddress, rememberSelfDevice, type SelfIdentity } from "../lib/selfIdentity";

export function useRememberSelfDevice(
  clients: WifiClientJson[],
  clientsSource: "lan" | "cloud" | null,
  self: SelfIdentity,
): void {
  const lastRecordedClientId = useRef<number | null>(null);
  useEffect(() => {
    // Only a LAN roster pairs with this machine's own addresses.
    if (clientsSource !== "lan") return;
    const own = clients.find((client) => matchesSelfByAddress(client, self));
    if (own?.clientId === undefined || own.clientId === lastRecordedClientId.current) return;
    lastRecordedClientId.current = own.clientId;
    rememberSelfDevice(own.clientId);
  }, [clients, clientsSource, self]);
}
