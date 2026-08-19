// The announcement a spent data allowance raises.
//
// Its key names one device, so no static definition can carry the wording and
// every host builds the spec here instead. Three of them announce the same trip
// under the same key — two recorders and the window — and history renders what
// was stored while a live panel renders what it computes, so a difference in
// wording between hosts reads back as two different events.

import type { AlertSpec } from "./alertDefinitions";
import { formatAllowance } from "./dataMeter";

/** Offered as the advice on a rule that asked for a pause this host cannot send. */
export const CONNECT_ACCOUNT_ADVICE =
  "Connect your Starlink account to have Dishylink pause a device when it reaches its allowance.";

export function dataLimitAlertKey(clientKey: string): string {
  return `dataLimit:${clientKey}`;
}

export function dataLimitAlertSpec(options: {
  clientKey: string;
  deviceName: string;
  allocationBytes: number;
  /** Shown on the ⓘ; omitted when nothing is left for the user to do. */
  advice?: string;
}): AlertSpec {
  const key = dataLimitAlertKey(options.clientKey);
  return {
    key,
    ok: `${options.deviceName} is within its data allowance`,
    firing: `${options.deviceName} reached its ${formatAllowance(options.allocationBytes)} data allowance`,
    advice: options.advice,
    severity: "warning",
    notify: true,
    // Retires on a timer, so `ok` would claim a device is within its allowance
    // while it is still capped.
    notifyClear: false,
  };
}
