// What the DNS fields decide before anything is sent to the router.

import { normalizeIpAddress } from "@core/ipAddress";

/** Blank rows are dropped, so leaving a backup empty is not an error. */
export function nameserversFrom(fields: readonly string[]): string[] {
  return fields.map((field) => field.trim()).filter((field) => field !== "");
}

/** Every non-empty field has to be an address, and there has to be a primary —
 *  the router's own app requires one too, since a list with only backups has
 *  nothing to try first. */
export function dnsFieldsValid(fields: readonly string[]): boolean {
  const filled = nameserversFrom(fields);
  if (filled.length === 0) return false;
  if (fields[0].trim() === "") return false;
  return filled.every((field) => normalizeIpAddress(field) !== null);
}
