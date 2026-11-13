// Where a dev run keeps the dish's address.
//
// Mirrors devRouterAddress: a build that serves itself hands its recorder the
// app's own preferences, but a dev run has Vite for a window and a separate
// historian process, so both consult this file and agree without either owning
// the other's store.
//
// Read per call: it is edited while both processes are up.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeIpAddress } from "../core/ipAddress.ts";

export const DEV_DISH_ADDRESS_FILE = resolve(".dish-address");

export function readDevDishAddress(): string | null {
  try {
    return existsSync(DEV_DISH_ADDRESS_FILE)
      ? normalizeIpAddress(readFileSync(DEV_DISH_ADDRESS_FILE, "utf8"))
      : null;
  } catch {
    return null;
  }
}
