// Every alert the dish and router can raise, defined once.
//
// Both devices send alerts as bare booleans, and proto3 JSON drops false — so an
// absent key means "fine", never "unknown". Each entry therefore carries both
// faces: what to say when the flag is clear, and what to say when it is set.
// The clear-state wording follows the Starlink app's own Status list ("Motors
// healthy", "Mast is near vertical", "Not heating") so the two read alike.
//
// This is the source of truth for the notification panel, the status list, and
// which alerts are worth a desktop notification. It lives in core/ because every
// host needs it: the wording and the `notify` flag decide what each of them puts
// in front of the user, and keeping them somewhere only the browser could read
// is what tied alerting to an open window.
//
// The wording itself is a catalog key, resolved with the host's own t() at the
// moment it reaches a person, so the same alert reads in the user's language on
// the desktop, in the extension and in a tab alike.

import type { TranslationKey } from "./i18n/resources";

export type AlertSeverity = "critical" | "warning" | "advisory";

export interface AlertSpec {
  key: string;
  /** Shown when the flag is false — phrased as the good news, like the app. */
  ok: TranslationKey;
  /**
   * Shown when the flag is true. Plain language: what is wrong, in the user's
   * terms — the condition only. It is the alert's one message, used verbatim
   * live and in history, so the same event never reads two different ways.
   */
  firing: TranslationKey;
  /**
   * What to do about it, if there is anything. Kept out of `firing` so the
   * message stays a statement of fact: an instruction is useful next to a live
   * alert and noise against one that cleared an hour ago. Surfaced on the ⓘ.
   */
  advice?: TranslationKey;
  /** Interpolation values for `ok`/`firing`, on the few alerts whose wording
   *  names a subject (a data limit names the device and the allowance). */
  vars?: Record<string, string | number>;
  severity: AlertSeverity;
  /** Worth interrupting someone with a desktop notification. */
  notify?: boolean;
  /** Whether the clearing is worth announcing too. Defaults to yes: most alerts
   *  here clear because a fault ended, which is news. False for one that retires
   *  on a timer, where nothing has changed to report. */
  notifyClear?: boolean;
}

/** The dish's heat flags, which the event log and the outage reports read as
 *  thermal episodes. */
export const THERMAL_ALERT_KEYS: readonly string[] = [
  "thermalThrottle",
  "thermalShutdown",
  "powerSupplyThermalThrottle",
];

/** Alerts on the dish's get_status. Order is roughly by how much it matters. */
export const DISH_ALERTS: AlertSpec[] = [
  {
    key: "dishWaterDetected",
    ok: "alerts.dish.dishWaterDetected.ok",
    firing: "alerts.dish.dishWaterDetected.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "routerWaterDetected",
    ok: "alerts.dish.routerWaterDetected.ok",
    firing: "alerts.dish.routerWaterDetected.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "thermalShutdown",
    ok: "alerts.dish.thermalShutdown.ok",
    firing: "alerts.dish.thermalShutdown.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "noEthernetLink",
    ok: "alerts.dish.noEthernetLink.ok",
    firing: "alerts.dish.noEthernetLink.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "motorsStuck",
    ok: "alerts.dish.motorsStuck.ok",
    firing: "alerts.dish.motorsStuck.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "thermalThrottle",
    ok: "alerts.dish.thermalThrottle.ok",
    firing: "alerts.dish.thermalThrottle.firing",
    severity: "warning",
    notify: true,
  },
  {
    key: "powerSupplyThermalThrottle",
    ok: "alerts.dish.powerSupplyThermalThrottle.ok",
    firing: "alerts.dish.powerSupplyThermalThrottle.firing",
    severity: "warning",
    notify: true,
  },
  {
    key: "slowEthernetSpeeds",
    ok: "alerts.dish.slowEthernetSpeeds.ok",
    firing: "alerts.dish.slowEthernetSpeeds.firing",
    severity: "warning",
    notify: true,
  },
  {
    key: "slowEthernetSpeeds100",
    ok: "alerts.dish.slowEthernetSpeeds100.ok",
    firing: "alerts.dish.slowEthernetSpeeds100.firing",
    advice: "alerts.dish.slowEthernetSpeeds100.advice",
    severity: "warning",
  },
  {
    key: "upsuRouterPortSlow",
    ok: "alerts.dish.upsuRouterPortSlow.ok",
    firing: "alerts.dish.upsuRouterPortSlow.firing",
    severity: "warning",
  },
  {
    key: "mastNotNearVertical",
    ok: "alerts.dish.mastNotNearVertical.ok",
    firing: "alerts.dish.mastNotNearVertical.firing",
    severity: "warning",
  },
  {
    key: "lowMotorCurrent",
    ok: "alerts.dish.lowMotorCurrent.ok",
    firing: "alerts.dish.lowMotorCurrent.firing",
    severity: "warning",
  },
  {
    key: "lowerSignalThanPredicted",
    ok: "alerts.dish.lowerSignalThanPredicted.ok",
    firing: "alerts.dish.lowerSignalThanPredicted.firing",
    advice: "alerts.dish.lowerSignalThanPredicted.advice",
    severity: "warning",
  },
  {
    key: "dbfTelemStale",
    ok: "alerts.dish.dbfTelemStale.ok",
    firing: "alerts.dish.dbfTelemStale.firing",
    severity: "warning",
  },
  {
    key: "unexpectedLocation",
    ok: "alerts.dish.unexpectedLocation.ok",
    firing: "alerts.dish.unexpectedLocation.firing",
    severity: "warning",
  },
  {
    key: "obstructionMapReset",
    ok: "alerts.dish.obstructionMapReset.ok",
    firing: "alerts.dish.obstructionMapReset.firing",
    severity: "advisory",
  },
  {
    key: "roaming",
    ok: "alerts.dish.roaming.ok",
    firing: "alerts.dish.roaming.firing",
    severity: "advisory",
  },
  {
    key: "isHeating",
    ok: "alerts.dish.isHeating.ok",
    firing: "alerts.dish.isHeating.firing",
    severity: "advisory",
  },
  {
    key: "isPowerSaveIdle",
    ok: "alerts.dish.isPowerSaveIdle.ok",
    firing: "alerts.dish.isPowerSaveIdle.firing",
    severity: "advisory",
  },
  {
    key: "installPending",
    ok: "alerts.dish.installPending.ok",
    firing: "alerts.dish.installPending.firing",
    severity: "advisory",
  },
];

/** Alerts on the router's get_status. */
export const ROUTER_ALERTS: AlertSpec[] = [
  {
    key: "poeFuseBlown",
    ok: "alerts.router.poeFuseBlown.ok",
    firing: "alerts.router.poeFuseBlown.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeVinOvervoltage",
    ok: "alerts.router.poeVinOvervoltage.ok",
    firing: "alerts.router.poeVinOvervoltage.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeVinUndervoltage",
    ok: "alerts.router.poeVinUndervoltage.ok",
    firing: "alerts.router.poeVinUndervoltage.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeRouterOvercurrent",
    ok: "alerts.router.poeRouterOvercurrent.ok",
    firing: "alerts.router.poeRouterOvercurrent.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeOnDishUnreachable",
    ok: "alerts.router.poeOnDishUnreachable.ok",
    firing: "alerts.router.poeOnDishUnreachable.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "ethSwitchError",
    ok: "alerts.router.ethSwitchError.ok",
    firing: "alerts.router.ethSwitchError.firing",
    severity: "critical",
    notify: true,
  },
  {
    key: "wanEthPoorConnection",
    ok: "alerts.router.wanEthPoorConnection.ok",
    firing: "alerts.router.wanEthPoorConnection.firing",
    severity: "warning",
    notify: true,
  },
  {
    key: "highCablePingDropRate",
    ok: "alerts.router.highCablePingDropRate.ok",
    firing: "alerts.router.highCablePingDropRate.firing",
    advice: "alerts.router.highCablePingDropRate.advice",
    severity: "warning",
    notify: true,
  },
  {
    key: "thermalThrottle",
    ok: "alerts.router.thermalThrottle.ok",
    firing: "alerts.router.thermalThrottle.firing",
    severity: "warning",
    notify: true,
  },
  {
    key: "meshUnreliableBackhaul",
    ok: "alerts.router.meshUnreliableBackhaul.ok",
    firing: "alerts.router.meshUnreliableBackhaul.firing",
    severity: "warning",
  },
  {
    key: "meshTopologyChangingOften",
    ok: "alerts.router.meshTopologyChangingOften.ok",
    firing: "alerts.router.meshTopologyChangingOften.firing",
    severity: "warning",
  },
  {
    key: "lanEthSlowLink10",
    ok: "alerts.router.lanEthSlowLink10.ok",
    firing: "alerts.router.lanEthSlowLink10.firing",
    severity: "warning",
  },
  {
    key: "lanEthSlowLink100",
    ok: "alerts.router.lanEthSlowLink100.ok",
    firing: "alerts.router.lanEthSlowLink100.firing",
    severity: "warning",
  },
  {
    key: "wiredMeshNotUsingWanIface",
    ok: "alerts.router.wiredMeshNotUsingWanIface.ok",
    firing: "alerts.router.wiredMeshNotUsingWanIface.firing",
    severity: "warning",
  },
  {
    key: "poeOffCurrentNominal",
    ok: "alerts.router.poeOffCurrentNominal.ok",
    firing: "alerts.router.poeOffCurrentNominal.firing",
    severity: "warning",
  },
  {
    key: "radiusMissingProcess",
    ok: "alerts.router.radiusMissingProcess.ok",
    firing: "alerts.router.radiusMissingProcess.firing",
    severity: "warning",
  },
  {
    key: "installPending",
    ok: "alerts.router.installPending.ok",
    firing: "alerts.router.installPending.firing",
    severity: "advisory",
  },
  {
    key: "freshlyFused",
    ok: "alerts.router.freshlyFused.ok",
    firing: "alerts.router.freshlyFused.firing",
    severity: "advisory",
  },
  {
    key: "sandboxDisabled",
    ok: "alerts.router.sandboxDisabled.ok",
    firing: "alerts.router.sandboxDisabled.firing",
    severity: "advisory",
  },
  {
    key: "onlyOverflightBlocked",
    ok: "alerts.router.onlyOverflightBlocked.ok",
    firing: "alerts.router.onlyOverflightBlocked.firing",
    severity: "advisory",
  },
  {
    key: "offlineNetworksDisabled",
    ok: "alerts.router.offlineNetworksDisabled.ok",
    firing: "alerts.router.offlineNetworksDisabled.firing",
    severity: "advisory",
  },
];

/** The two real devices, plus "system" for alerts the app raises about itself
 *  (e.g. the history recorder being down) rather than reading off a device. */
export type AlertSource = "dish" | "router" | "system";

export interface AlertState extends AlertSpec {
  active: boolean;
  /** Both devices use overlapping keys (e.g. thermalThrottle), so source disambiguates. */
  source: AlertSource;
}

/**
 * Conditions a host observes ABOUT a device rather than reads OFF one: a device
 * not answering can never appear in that device's own alert payload, because the
 * payload is what failed to arrive.
 *
 * Declared once, and used for both faces — the live alert and the history label.
 * They were two separate literals carrying the same wording, which is a rename
 * away from history and the alert panel describing the same event differently.
 *
 * A device that has stopped answering is critical and is raised the instant it
 * happens. Nothing here waits to see whether it recovers: a delay would mean the
 * connection status indicator showing "dish unreachable" while the alert panel
 * still said "no active alerts", and the whole point of an alert is that it
 * arrives when the thing goes wrong, not once it has been wrong for a while.
 */
export const SYSTEM_ALERTS = {
  dishUnreachable: {
    key: "dishUnreachable",
    ok: "alerts.system.dishUnreachable.ok",
    firing: "alerts.system.dishUnreachable.firing",
    advice: "alerts.system.dishUnreachable.advice",
    severity: "critical",
    notify: true,
  },
  routerUnreachable: {
    key: "routerUnreachable",
    ok: "alerts.system.routerUnreachable.ok",
    firing: "alerts.system.routerUnreachable.firing",
    severity: "warning",
    notify: true,
  },
  // The satellite side is down while the hardware here is fine — the dish is
  // powered and answering, its pings to the point of presence are not coming
  // back. It is a condition ABOUT the link rather than a flag either device
  // raises, so like unreachability it can never appear in a device's own alert
  // payload; something has to watch the drop rate and say so.
  starlinkOutage: {
    key: "starlinkOutage",
    ok: "alerts.system.starlinkOutage.ok",
    firing: "alerts.system.starlinkOutage.firing",
    advice: "alerts.system.starlinkOutage.advice",
    severity: "critical",
    notify: true,
  },
  // Recorded by the recorder about itself: a boot that finds its heartbeat
  // stale logs the gap, so History can say "not recorded" instead of implying
  // "nothing happened". Never fires live — historianDown covers the present.
  recorderOff: {
    key: "recorderOff",
    ok: "alerts.system.recorderOff.ok",
    firing: "alerts.system.recorderOff.firing",
    severity: "advisory",
  },
  // The historian being down is itself an alert: recording has silently stopped.
  // Only a host that reaches the historian across a boundary can observe it —
  // the desktop app runs it in-process, where its absence means the app is gone.
  historianDown: {
    key: "historianDown",
    ok: "alerts.system.historianDown.ok",
    firing: "alerts.system.historianDown.firing",
    severity: "warning",
    notify: true,
  },
} satisfies Record<string, AlertSpec>;

/** A system definition as a firing alert. One definition, both faces. */
export function firingSystemAlert(spec: AlertSpec): AlertState {
  return { ...spec, source: "system", active: true };
}

/** Every definition, keyed "source:key" — the lookup history uses to put an
 *  alert's wording on a recorded episode. */
export const SPEC_BY_SOURCE_KEY = new Map<string, AlertSpec>([
  ...DISH_ALERTS.map((spec) => [`dish:${spec.key}`, spec] as const),
  ...ROUTER_ALERTS.map((spec) => [`router:${spec.key}`, spec] as const),
  ...Object.values(SYSTEM_ALERTS).map((spec) => [`system:${spec.key}`, spec] as const),
]);

/** Fold a device's raw alert booleans against its definitions. Absent = clear. */
export function resolveAlerts(
  specs: AlertSpec[],
  alerts: Record<string, boolean> | undefined,
  source: AlertSource,
): AlertState[] {
  return specs.map((spec) => ({ ...spec, source, active: alerts?.[spec.key] === true }));
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, advisory: 2 };

/** Active alerts first, worst first. */
export function sortBySeverity(states: AlertState[]): AlertState[] {
  return [...states].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
