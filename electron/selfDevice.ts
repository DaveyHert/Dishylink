// Who this machine is on the router's roster, for the surfaces that must not act
// on it: the pause refusal in core/routerClientUpdate, and the window's own
// "This device" flag.
//
// The id is reported by the window and is only as trustworthy as it is; the
// addresses beside it are read in this process.

import { localNetworkIdentity, type HostNetworkIdentity } from "../core/hostNetworkIdentity";
import { preferences, setPreference } from "./preferences";

export function hostIdentity(): HostNetworkIdentity {
  const clientId = preferences().selfClientId;
  return {
    ...localNetworkIdentity(),
    ...(clientId === null ? {} : { clientId }),
  };
}

/** A router reset renumbers every client, so the newest LAN answer replaces what
 *  is stored rather than being discarded in its favour. */
export function rememberSelfDevice(clientId: number): void {
  if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xffff_ffff) return;
  if (preferences().selfClientId !== clientId) setPreference("selfClientId", clientId);
}
