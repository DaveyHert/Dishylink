// The one place an alert becomes news.
//
// Every host polls the same two devices and then faces the same question: what
// changed since the last reading? Answering it separately in each — the
// recorder, the extension's drain, the browser's alert hook — is what lets the
// live panel and the history log describe one event two ways: the recorder logs
// the dish's latched noEthernetLink flag while the panel, knowing the firmware
// lies about it, hides it.
//
// So the answer lives here and a host's job shrinks to two ends: hand over a
// reading, deliver the transitions that come back — a desktop notification, a
// line in the log, a badge on the panel. How a reading was obtained and where a
// transition goes are both somebody else's business.
//
// A reading is per device and carries its own clock. The two devices are asked
// separately and either may sit for its full timeout, so one timestamp for both
// would date a reading by when the cycle began rather than when the reply came
// back — the error that once wrote overlapping episodes, and one that closed
// before it opened. Omitting a device entirely says "not asked this cycle",
// which is not the same as asking and getting nothing: the first leaves its
// alerts exactly as they were, the second raises unreachability.

import {
  DISH_ALERTS,
  ROUTER_ALERTS,
  SPEC_BY_SOURCE_KEY,
  SYSTEM_ALERTS,
  firingSystemAlert,
  resolveAlerts,
  sortBySeverity,
  type AlertSpec,
  type AlertSource,
  type AlertState,
} from "./alertDefinitions";
import { routerSilenceExpected, type RouterPresence } from "./routerPresence";

/** One device's reply, stamped when it arrived. */
export interface DeviceReading {
  /** The device's alert booleans; null when it did not answer at all. */
  alerts: Record<string, boolean> | null;
  /** When the reply came back — read after the call returned, not before it was
   *  sent. A timestamp taken before an await dates the intention, not the fact. */
  atMs: number;
}

export interface DishReading extends DeviceReading {
  /** The dish's negotiated Ethernet speed, when the reply carried one. Read to
   *  catch a flag the firmware latches — see correctLatchedEthernetFlag. */
  ethSpeedMbps?: number;
  /** What the dish says about the routers downstream of it. A router cannot
   *  report its own absence, so this is the only thing that tells a bypassed or
   *  missing router from one that has stopped answering. */
  routerPresence?: RouterPresence;
}

/** Conditions a host observes about itself rather than off a device. It governs
 *  exactly the keys it names here: a key left out is untouched, not cleared. */
export interface SystemReading {
  alerts: Record<string, boolean>;
  atMs: number;
}

/**
 * What a host saw this cycle. Each part is optional — a host reports only what
 * it actually asked. The extension's drain polls the router on its own schedule;
 * the browser learns about the recorder and nothing else.
 */
export interface AlertObservation {
  dish?: DishReading;
  router?: DeviceReading;
  system?: SystemReading;
}

/** An alert crossing into or out of firing — the only thing worth telling anyone. */
export interface AlertTransition {
  kind: "fired" | "cleared";
  source: AlertSource;
  key: string;
  /** The stamp of the reading that caused it, so a log records when the device
   *  said so rather than when this ran. */
  atMs: number;
  /** The alert's definition — wording and severity — so delivering one needs no
   *  second lookup. */
  spec: AlertSpec;
}

/** An alert already known to be firing when an engine is built — the recorder's
 *  unclosed episodes, restored across a restart. */
export interface FiringAlertId {
  source: AlertSource;
  key: string;
}

function identify(source: AlertSource, key: string): string {
  return `${source}:${key}`;
}

/**
 * The dish latches `noEthernetLink` long after a flap ends: probed live
 * (2026-07-20), the flag stayed set 40+ minutes while the same reply reported a
 * working 1000 Mbps link. When the reply contradicts itself — link flagged down
 * AND a negotiated speed present — trust the speed. A genuinely dead link makes
 * the dish unreachable from the LAN, which raises its own critical alert, so
 * nothing real is silenced.
 */
function correctLatchedEthernetFlag(
  checks: AlertState[],
  ethSpeedMbps: number | undefined,
): AlertState[] {
  if ((ethSpeedMbps ?? 0) <= 0) return checks;
  return checks.map((check) =>
    check.key === "noEthernetLink" && check.active ? { ...check, active: false } : check,
  );
}

const DISH_SCOPE = new Set([
  ...DISH_ALERTS.map((spec) => identify("dish", spec.key)),
  identify("system", SYSTEM_ALERTS.dishUnreachable.key),
]);
const ROUTER_SCOPE = new Set([
  ...ROUTER_ALERTS.map((spec) => identify("router", spec.key)),
  identify("system", SYSTEM_ALERTS.routerUnreachable.key),
]);

export class AlertEngine {
  /** Everything firing as of the last reading, keyed "source:key". */
  private firing = new Map<string, AlertState>();
  /** The last reading's checks per device, kept so an unanswered poll leaves the
   *  previous values standing rather than reading as an all-clear. */
  private dishChecks: AlertState[] = resolveAlerts(DISH_ALERTS, undefined, "dish");
  /** The dish's last word on whether a router should be answering at all. Held
   *  across a silent dish poll: a dish that stops replying has no new opinion. */
  private routerPresence: RouterPresence | null = null;
  private routerChecks: AlertState[] = resolveAlerts(ROUTER_ALERTS, undefined, "router");

  /**
   * `alreadyFiring` restores what the host already knows to be open. Without it
   * a recorder restart reads every still-open alert as new and announces water
   * in the dish a second time, hours after anyone could act on it.
   */
  constructor(alreadyFiring: Iterable<FiringAlertId> = []) {
    for (const { source, key } of alreadyFiring) {
      const spec = SPEC_BY_SOURCE_KEY.get(identify(source, key));
      if (spec) this.firing.set(identify(source, key), { ...spec, source, active: true });
    }
  }

  /** Fold a cycle's readings in, and report what crossed a threshold. */
  update(observation: AlertObservation): AlertTransition[] {
    const transitions: AlertTransition[] = [];

    if (observation.dish) {
      const { alerts, atMs, ethSpeedMbps, routerPresence } = observation.dish;
      if (alerts !== null) {
        this.dishChecks = correctLatchedEthernetFlag(
          resolveAlerts(DISH_ALERTS, alerts, "dish"),
          ethSpeedMbps,
        );
        if (routerPresence !== undefined) this.routerPresence = routerPresence;
      }
      transitions.push(
        ...this.reconcile(
          DISH_SCOPE,
          alerts === null
            ? // No reply. Its own alerts are held exactly as they were — closing
              // them would record a recovery nobody observed — and the silence
              // itself is raised, since the one condition that hides a device's
              // whole check list can never appear inside that list.
              [...this.heldFor("dish"), firingSystemAlert(SYSTEM_ALERTS.dishUnreachable)]
            : this.dishChecks.filter((check) => check.active),
          atMs,
        ),
      );
    }

    if (observation.router) {
      const { alerts, atMs } = observation.router;
      if (alerts !== null) {
        this.routerChecks = resolveAlerts(ROUTER_ALERTS, alerts, "router");
      }
      const expected = routerSilenceExpected(this.routerPresence);
      transitions.push(
        ...this.reconcile(
          ROUTER_SCOPE,
          alerts === null
            ? [
                ...this.heldFor("router"),
                ...(expected ? [] : [firingSystemAlert(SYSTEM_ALERTS.routerUnreachable)]),
              ]
            : this.routerChecks.filter((check) => check.active),
          atMs,
        ),
      );
    }

    if (observation.system) {
      const { alerts, atMs } = observation.system;
      const scope = new Set(Object.keys(alerts).map((key) => identify("system", key)));
      const desired = Object.entries(alerts).flatMap(([key, active]) => {
        const spec = active ? SYSTEM_ALERTS[key as keyof typeof SYSTEM_ALERTS] : undefined;
        return spec ? [firingSystemAlert(spec)] : [];
      });
      transitions.push(...this.reconcile(scope, desired, atMs));
    }

    return transitions;
  }

  /** This source's alerts as they stand, for holding open across a silent poll. */
  private heldFor(source: AlertSource): AlertState[] {
    return [...this.firing.values()].filter((alert) => alert.source === source);
  }

  /**
   * Diff one reading's worth of alerts against what was firing, touching only
   * the keys that reading governs. Scoping matters because "system" is shared:
   * a dish reading owns dishUnreachable, and must not clear the recorder alert
   * that only the browser can see.
   */
  private reconcile(
    scope: ReadonlySet<string>,
    desired: AlertState[],
    atMs: number,
  ): AlertTransition[] {
    const transitions: AlertTransition[] = [];
    const current = new Map(desired.map((alert) => [identify(alert.source, alert.key), alert]));

    for (const [id, alert] of current) {
      if (!this.firing.has(id))
        transitions.push({
          kind: "fired",
          source: alert.source,
          key: alert.key,
          atMs,
          spec: alert,
        });
    }
    for (const [id, alert] of this.firing) {
      if (!scope.has(id) || current.has(id)) continue;
      transitions.push({
        kind: "cleared",
        source: alert.source,
        key: alert.key,
        atMs,
        spec: alert,
      });
    }

    for (const id of scope) if (!current.has(id)) this.firing.delete(id);
    for (const [id, alert] of current) this.firing.set(id, alert);
    return transitions;
  }

  /** Everything firing right now, worst first. */
  activeAlerts(): AlertState[] {
    return sortBySeverity([...this.firing.values()]);
  }

  /** Every check on both devices, clear and firing, in definition order — the
   *  Status list. After an unanswered poll these are the last known values, not
   *  live ones; the caller pairs them with the reachability it was told. */
  statusList(): AlertState[] {
    return [...this.dishChecks, ...this.routerChecks];
  }
}
