// Which host owns the address the app dials the router at.
//
// Every host reaches the router its own way — the desktop app through its main
// process, the extension through its service worker and an optional host
// permission — and some cannot offer the choice at all. A web page has no way to
// reach an arbitrary LAN address whatever it is told, so it binds nothing and the
// settings rows do not render.
//
// The shape mirrors lib/apiHost: the app asks, and never learns which host
// answered.

export interface RouterAddress {
  router: string | null;
  routerDefault: string;
}

/** Why a write did not take. The reasons are distinct because they need different
 *  words: a rejected address is the user's to retype, a declined permission is
 *  theirs to grant, and an unsupported one is the host's limit and retyping the
 *  same thing will never help. */
export type RouterAddressWriteResult =
  | { ok: true; addresses: RouterAddress }
  | { ok: false; reason: "invalid" | "denied" | "unsupported" };

export interface RouterAddressBinding {
  read: () => Promise<RouterAddress>;
  /** A null address clears the setting back to the default. Anything refused
   *  leaves what is stored untouched. */
  write: (address: string | null) => Promise<RouterAddressWriteResult>;
}

let binding: RouterAddressBinding | null = null;

/** Called once by a host entry point, before the UI renders. */
export function setRouterAddressHost(hostBinding: RouterAddressBinding): void {
  binding = hostBinding;
}

export function routerAddressHost(): RouterAddressBinding | null {
  return binding;
}
