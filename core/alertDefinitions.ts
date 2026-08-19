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

export type AlertSeverity = "critical" | "warning" | "advisory";

export interface AlertSpec {
  key: string;
  /** Shown when the flag is false — phrased as the good news, like the app. */
  ok: string;
  /**
   * Shown when the flag is true. Plain language: what is wrong, in the user's
   * terms — the condition only. It is the alert's one message, used verbatim
   * live and in history, so the same event never reads two different ways.
   */
  firing: string;
  /**
   * What to do about it, if there is anything. Kept out of `firing` so the
   * message stays a statement of fact: an instruction is useful next to a live
   * alert and noise against one that cleared an hour ago. Surfaced on the ⓘ.
   */
  advice?: string;
  severity: AlertSeverity;
  /** Worth interrupting someone with a desktop notification. */
  notify?: boolean;
  /** Whether the clearing is worth announcing too. Defaults to yes: most alerts
   *  here clear because a fault ended, which is news. False for one that retires
   *  on a timer, where nothing has changed to report. */
  notifyClear?: boolean;
}

/** Alerts on the dish's get_status. Order is roughly by how much it matters. */
export const DISH_ALERTS: AlertSpec[] = [
  {
    key: "dishWaterDetected",
    ok: "No water inside the dish",
    firing: "Water detected inside the dish",
    severity: "critical",
    notify: true,
  },
  {
    key: "routerWaterDetected",
    ok: "No water inside the router",
    firing: "Water detected inside the router",
    severity: "critical",
    notify: true,
  },
  {
    key: "thermalShutdown",
    ok: "Not overheated",
    firing: "Dish shut itself down to cool off",
    severity: "critical",
    notify: true,
  },
  {
    key: "noEthernetLink",
    ok: "Ethernet connected",
    firing: "No Ethernet link to the router",
    severity: "critical",
    notify: true,
  },
  {
    key: "motorsStuck",
    ok: "Motors healthy",
    firing: "Motors are stuck — the dish cannot aim itself",
    severity: "critical",
    notify: true,
  },
  {
    key: "thermalThrottle",
    ok: "Normal temperature",
    firing: "Dish is hot and is limiting speed to cool down",
    severity: "warning",
    notify: true,
  },
  {
    key: "powerSupplyThermalThrottle",
    ok: "Power supply temperature normal",
    firing: "Power supply is hot and is limiting power",
    severity: "warning",
    notify: true,
  },
  {
    key: "slowEthernetSpeeds",
    ok: "Normal Ethernet speeds to router",
    firing: "Slow Ethernet link to the router",
    severity: "warning",
    notify: true,
  },
  {
    key: "slowEthernetSpeeds100",
    ok: "Ethernet running at full speed",
    firing: "Ethernet is capped at 100 Mbps",
    advice: "Check the cable between the dish and the router.",
    severity: "warning",
  },
  {
    key: "upsuRouterPortSlow",
    ok: "Power supply port normal",
    firing: "Power supply's router port is running slow",
    severity: "warning",
  },
  {
    key: "mastNotNearVertical",
    ok: "Mast is near vertical",
    firing: "Mast is not near vertical",
    severity: "warning",
  },
  {
    key: "lowMotorCurrent",
    ok: "Motor current normal",
    firing: "Low motor current",
    severity: "warning",
  },
  {
    key: "lowerSignalThanPredicted",
    ok: "Signal as predicted",
    firing: "Weather interference",
    advice:
      "Heavy rain, snow, or thick cloud is weakening the signal below what the dish predicted — it clears when the weather does. If skies are clear, check the dish's view of the sky for new obstructions.",
    severity: "warning",
  },
  {
    key: "dbfTelemStale",
    ok: "Telemetry current",
    firing: "Dish telemetry has gone stale",
    severity: "warning",
  },
  {
    key: "unexpectedLocation",
    ok: "At service location",
    firing: "Dish is away from its registered service location",
    severity: "warning",
  },
  {
    key: "obstructionMapReset",
    ok: "Obstruction map intact",
    firing: "Obstruction map was reset — it is remapping the sky",
    severity: "advisory",
  },
  {
    key: "roaming",
    ok: "Not roaming",
    firing: "Roaming — away from your registered address",
    severity: "advisory",
  },
  {
    key: "isHeating",
    ok: "Not heating",
    firing: "Heating itself to melt snow or ice",
    severity: "advisory",
  },
  {
    key: "isPowerSaveIdle",
    ok: "Not sleeping",
    firing: "Sleeping to save power",
    severity: "advisory",
  },
  {
    key: "installPending",
    ok: "Starlink software update install completed",
    firing: "Starlink software update install pending",
    severity: "advisory",
  },
];

/** Alerts on the router's get_status. */
export const ROUTER_ALERTS: AlertSpec[] = [
  {
    key: "poeFuseBlown",
    ok: "Power supply fuse intact",
    firing: "Power supply fuse has blown",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeVinOvervoltage",
    ok: "Power input normal",
    firing: "Power supply input voltage is too high",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeVinUndervoltage",
    ok: "Power input steady",
    firing: "Power supply input voltage is too low",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeRouterOvercurrent",
    ok: "Router current normal",
    firing: "Router is drawing too much current",
    severity: "critical",
    notify: true,
  },
  {
    key: "poeOnDishUnreachable",
    ok: "Dish reachable over power supply",
    firing: "Cannot reach the dish through the power supply",
    severity: "critical",
    notify: true,
  },
  {
    key: "ethSwitchError",
    ok: "Ethernet switch healthy",
    firing: "Ethernet switch error",
    severity: "critical",
    notify: true,
  },
  {
    key: "wanEthPoorConnection",
    ok: "Good connection to the dish",
    firing: "Poor Ethernet connection to the dish",
    severity: "warning",
    notify: true,
  },
  {
    key: "highCablePingDropRate",
    ok: "Cable link clean",
    firing: "Cable is dropping pings",
    advice: "Check the Starlink cable and its connections at both ends.",
    severity: "warning",
    notify: true,
  },
  {
    key: "thermalThrottle",
    ok: "Router temperature normal",
    firing: "Router is hot and is slowing Wi-Fi to cool down",
    severity: "warning",
    notify: true,
  },
  {
    key: "meshUnreliableBackhaul",
    ok: "Mesh link reliable",
    firing: "Mesh nodes have an unreliable link to the router",
    severity: "warning",
  },
  {
    key: "meshTopologyChangingOften",
    ok: "Mesh layout stable",
    firing: "Mesh nodes keep switching how they connect",
    severity: "warning",
  },
  {
    key: "lanEthSlowLink10",
    ok: "LAN ports at full speed",
    firing: "A LAN port is stuck at 10 Mbps",
    severity: "warning",
  },
  {
    key: "lanEthSlowLink100",
    ok: "LAN ports not capped",
    firing: "A LAN port is capped at 100 Mbps",
    severity: "warning",
  },
  {
    key: "wiredMeshNotUsingWanIface",
    ok: "Wired mesh on the right port",
    firing: "Wired mesh node is not using its WAN port",
    severity: "warning",
  },
  {
    key: "poeOffCurrentNominal",
    ok: "Power supply output normal",
    firing: "Power supply is off but still drawing current",
    severity: "warning",
  },
  {
    key: "radiusMissingProcess",
    ok: "Access control running",
    firing: "Access-control process is missing",
    severity: "warning",
  },
  {
    key: "installPending",
    ok: "Router software update install completed",
    firing: "Router software update install pending",
    severity: "advisory",
  },
  {
    key: "freshlyFused",
    ok: "Router configured",
    firing: "Router is freshly fused and not yet set up",
    severity: "advisory",
  },
  {
    key: "sandboxDisabled",
    ok: "Sandbox available",
    firing: "Sandbox mode is disabled",
    severity: "advisory",
  },
  {
    key: "onlyOverflightBlocked",
    ok: "Service unrestricted",
    firing: "Only overflight service is blocked",
    severity: "advisory",
  },
  {
    key: "offlineNetworksDisabled",
    ok: "Offline networks available",
    firing: "Offline networks are disabled",
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
    ok: "Dish is answering",
    firing: "Dish isn’t answering",
    advice:
      "Check that the dish has power and that its cable to the router is seated at both ends.",
    severity: "critical",
    notify: true,
  },
  routerUnreachable: {
    key: "routerUnreachable",
    ok: "Router is answering",
    firing: "Router isn’t answering",
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
    ok: "Pings to the Starlink network are succeeding again",
    firing: "The dish is reachable, but pings to the Starlink network are failing",
    advice:
      "Nothing on your side is wrong. Heavy weather or a gap in satellite coverage will clear on its own.",
    severity: "critical",
    notify: true,
  },
  // Recorded by the recorder about itself: a boot that finds its heartbeat
  // stale logs the gap, so History can say "not recorded" instead of implying
  // "nothing happened". Never fires live — historianDown covers the present.
  recorderOff: {
    key: "recorderOff",
    ok: "Recording ran continuously",
    firing: "Recording was off — anything in this gap went unrecorded",
    severity: "advisory",
  },
  // The historian being down is itself an alert: recording has silently stopped.
  // Only a host that reaches the historian across a boundary can observe it —
  // the desktop app runs it in-process, where its absence means the app is gone.
  historianDown: {
    key: "historianDown",
    ok: "History recorder running",
    firing: "History recorder is down — live alerts still work, but nothing is being recorded",
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
