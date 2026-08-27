// Where a dev run keeps the router's address.
//
// A build that serves itself hands its recorder a reader onto the app's own
// preferences. Nothing does that for a dev run — the window is served by Vite and
// the historian is its own process — so both consult this file and agree without
// either owning the other's store.
//
// Read per call: it is edited while both processes are up.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeIpAddress } from "../core/ipAddress.ts";

export const DEV_ROUTER_ADDRESS_FILE = resolve(".router-address");

export function readDevRouterAddress(): string | null {
  try {
    return existsSync(DEV_ROUTER_ADDRESS_FILE)
      ? normalizeIpAddress(readFileSync(DEV_ROUTER_ADDRESS_FILE, "utf8"))
      : null;
  } catch {
    return null;
  }
}
