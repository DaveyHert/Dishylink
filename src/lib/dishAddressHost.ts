// Which host owns the address the app dials the dish at.
//
// Mirrors lib/routerAddressHost: every host reaches the dish its own way, and a
// host that cannot offer the choice binds nothing — which is what keeps the
// settings row out of a surface that would only be able to ignore it.

export interface DishAddress {
  dish: string | null;
  dishDefault: string;
}

/** Why a write did not take. The set matches the router's, because a host that
 *  can reach one LAN box can reach the other the same way. */
export type DishAddressWriteResult =
  | { ok: true; addresses: DishAddress }
  | { ok: false; reason: "invalid" | "denied" | "unsupported" };

export interface DishAddressBinding {
  read: () => Promise<DishAddress>;
  /** A null address clears the setting back to the default. Anything refused
   *  leaves what is stored untouched. */
  write: (address: string | null) => Promise<DishAddressWriteResult>;
}

let binding: DishAddressBinding | null = null;

/** Called once by a host entry point, before the UI renders. */
export function setDishAddressHost(hostBinding: DishAddressBinding): void {
  binding = hostBinding;
}

export function dishAddressHost(): DishAddressBinding | null {
  return binding;
}
