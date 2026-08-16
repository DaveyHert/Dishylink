// Which host asks the user to name their own device on the router's roster.
//
// A Chrome extension cannot read its machine's LAN address or MAC:
// chrome.system.network is packaged-app-only, and WebRTC offers only mDNS-masked
// candidates that match no client. Hosts that resolve the viewer themselves (see
// lib/selfIdentity) bind nothing here, and the setting does not render for them.

export interface SelfDeviceBinding {
  read: () => Promise<number | null>;
  /** Null clears the choice, which withdraws the pause control from every row. */
  write: (clientId: number | null) => Promise<void>;
}

let binding: SelfDeviceBinding | null = null;

/** Called once by a host entry point, before the UI renders. */
export function setSelfDeviceHost(hostBinding: SelfDeviceBinding): void {
  binding = hostBinding;
}

export function selfDeviceHost(): SelfDeviceBinding | null {
  return binding;
}
