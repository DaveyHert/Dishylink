// Where the app dials the router.
//
// This row has to keep working when the router does not answer, because a wrong
// address is the most likely reason it doesn't. Nothing here may sit behind a
// reachability check.

import { routerAddressHost, type RouterAddress } from "../../lib/routerAddressHost";
import { AddressRow, type AddressRowCopy } from "./AddressRow";

const COPY: AddressRowCopy = {
  title: "routerAddress.title",
  tip: "routerAddress.tip",
  defaultIs: "routerAddress.defaultIs",
  using: "routerAddress.using",
  refused: {
    invalid: "routerAddress.refusedInvalid",
    denied: "routerAddress.refusedDenied",
    unsupported: "routerAddress.refusedUnsupported",
  },
};

export function RouterAddressRow({
  addresses,
  onChanged,
}: {
  addresses: RouterAddress;
  onChanged: (next: RouterAddress) => void;
}) {
  return (
    <AddressRow
      stored={addresses.router}
      fallback={addresses.routerDefault}
      copy={COPY}
      save={async (address) => {
        const host = routerAddressHost();
        if (!host) return { ok: false, reason: "unsupported" };
        const result = await host.write(address);
        if (!result.ok) return result;
        onChanged(result.addresses);
        return { ok: true };
      }}
    />
  );
}
