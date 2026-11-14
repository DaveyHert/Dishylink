// Where the app dials the dish.
//
// 192.168.100.1 is right for every kit wired the ordinary way, so most people
// never touch this. It is wrong when another router sits in front of the dish —
// a Mini into a MikroTik, for example — and the dish is only reachable at the
// address that router forwards its port to. Like the router row, this one has to
// work while the dish is silent, which is exactly when it is needed.

import { dishAddressHost, type DishAddress } from "../../lib/dishAddressHost";
import { AddressRow, type AddressRowCopy } from "./AddressRow";

const COPY: AddressRowCopy = {
  title: "dishAddress.title",
  tip: "dishAddress.tip",
  defaultIs: "dishAddress.defaultIs",
  using: "dishAddress.using",
  refused: {
    invalid: "dishAddress.refusedInvalid",
    denied: "dishAddress.refusedDenied",
    unsupported: "dishAddress.refusedUnsupported",
  },
};

export function DishAddressRow({
  addresses,
  onChanged,
}: {
  addresses: DishAddress;
  onChanged: (next: DishAddress) => void;
}) {
  return (
    <AddressRow
      stored={addresses.dish}
      fallback={addresses.dishDefault}
      copy={COPY}
      save={async (address) => {
        const host = dishAddressHost();
        if (!host) return { ok: false, reason: "unsupported" };
        const result = await host.write(address);
        if (!result.ok) return result;
        onChanged(result.addresses);
        return { ok: true };
      }}
    />
  );
}
