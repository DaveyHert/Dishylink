// What the address field decides before anything reaches the host.

import { normalizeIpAddress } from "@core/ipAddress";

/** An empty box means "back to the default", which is a legitimate save; anything
 *  else has to be an address this app can actually dial. */
export function addressSavable(draft: string, stored: string | null): boolean {
  const trimmed = draft.trim();
  if (trimmed === (stored ?? "")) return false;
  return trimmed === "" || normalizeIpAddress(trimmed) !== null;
}

/** What the host is asked for: null to clear, otherwise the address as typed —
 *  the host normalises it and answers with what it actually stored. */
export function saveArgument(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed === "" ? null : trimmed;
}
