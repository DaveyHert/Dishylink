// Live alert state for the whole setup, owned by the browser.
//
// Both the dish and the router report their alerts as live booleans on
// get_status, and the Starlink app reads them straight off each device. So does
// this: dish alerts come from the telemetry poll already running (2s); router
// alerts from a light get_status poll this hook runs itself (5s). Neither goes
// through the historian — a page must be able to show the truth about the
// hardware even when the recorder is down, and the recorder's own health is
// surfaced here as an alert rather than depended on.
//
// This displays alerts, and announces them through announceAlert: the in-app
// chime whenever its own window is in front, and — only in a plain browser tab —
// the OS notification when it is not. A host with its own always-on process (the
// desktop main, the extension worker) owns that away-notification, posting it
// itself and holding it back while a window is in front — see hostAnnouncesAlerts.
// Whether an alert is worth interrupting someone for is neither decision: `notify`
// on the definition in core/alertDefinitions.ts is, so every host agrees about it.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DishStatusJson } from "@core/dishClient";
import { subscribeRouterStatus } from "../lib/routerStatusFeed";
import type { DishConnectionState } from "./useDishTelemetry";
import {
  DISH_ALERTS,
  ROUTER_ALERTS,
  SPEC_BY_SOURCE_KEY,
  SYSTEM_ALERTS,
  firingSystemAlert,
  resolveAlerts,
  sortBySeverity,
  type AlertSeverity,
  type AlertSource,
  type AlertState,
} from "@core/alertDefinitions";
import { announceAlert } from "../lib/notifications";
import { routerPresence, routerSilenceExpected } from "@core/routerPresence";
import { apiRequest, recorderRunsInHostProcess } from "../lib/apiHost";
import { useMetersEnforceable, useTrippedMeters, type MeterRuleView } from "./useDataMeter";
import { CONNECT_ACCOUNT_ADVICE, dataLimitAlertSpec } from "@core/dataMeterAlert";

const HISTORY_POLL_MS = 30_000;

/** An episode as the historian serves it on /api/alerts. */
interface AlertEpisodeJson {
  source: AlertSource;
  key: string;
  startMs: number;
  endMs: number | null;
  /** What was announced. Absent where the wording is a constant looked up below. */
  label?: string;
  severity?: AlertSeverity;
}

export interface AlertHistoryEntry {
  source: AlertSource;
  key: string;
  startMs: number;
  endMs: number | null;
  /** Wording from the definitions, or a humanised raw key if the firmware added one we don't know. */
  label: string;
  severity: AlertState["severity"];
}

export interface DeviceAlerts {
  /** Everything firing right now, worst first — includes a synthetic historian-down alert. */
  active: AlertState[];
  /** Every check on both devices, clear and firing, in definition order — the Status list. */
  statusList: AlertState[];
  /** Past episodes from the historian, newest first. Empty when the historian is down. */
  history: AlertHistoryEntry[];
  /** null while first probing; false when the router get_status poll is failing. */
  routerReachable: boolean | null;
  /** null while first probing; false when the historian (history) is unreachable. */
  historianUp: boolean | null;
  /** False when the dish isn't answering: its checks below are the last known
   *  values, not live, and must not be read as "all clear". */
  dishReachable: boolean;
  /** "source:key" -> when this tab first saw it firing. The fallback start time
   *  for alerts with no recorded episode. */
  firstSeen: Map<string, number>;
}

const DISH_UNREACHABLE = firingSystemAlert(SYSTEM_ALERTS.dishUnreachable);
const ROUTER_UNREACHABLE = firingSystemAlert(SYSTEM_ALERTS.routerUnreachable);
const HISTORIAN_DOWN = firingSystemAlert(SYSTEM_ALERTS.historianDown);

/**
 * A log of when each alert was first seen firing, held outside React's render.
 *
 * Written from the transitions effect, read through useSyncExternalStore. A
 * first-seen stamp records that a moment happened, and a render is not a moment —
 * it can run twice or be thrown away — so the write belongs to the effect.
 *
 * Scoped to one hook instance: every mount starts from an empty log.
 */
function createFirstSeenLog() {
  let seen = new Map<string, number>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The same map until something changes: useSyncExternalStore compares by
     *  identity, and a fresh map every read would re-render on every poll. */
    snapshot: (): Map<string, number> => seen,
    /** Stamp anything newly firing, and forget anything cleared so a recurrence is
     *  timed from its new onset. Silent when neither happened. */
    observe(activeIds: Iterable<string>): void {
      const current = new Set(activeIds);
      const next = new Map(seen);
      let changed = false;
      const seenAt = Date.now();
      for (const id of current)
        if (!next.has(id)) {
          next.set(id, seenAt);
          changed = true;
        }
      for (const id of seen.keys())
        if (!current.has(id)) {
          next.delete(id);
          changed = true;
        }
      if (!changed) return;
      seen = next;
      for (const listener of listeners) listener();
    },
  };
}

function dataLimitAlert(rule: MeterRuleView, enforceable: boolean): AlertState {
  return {
    ...dataLimitAlertSpec(rule, rule.deviceName, {
      advice: rule.autoPause && !enforceable ? CONNECT_ACCOUNT_ADVICE : undefined,
      groupName: rule.groupName,
    }),
    source: "system",
    active: true,
  };
}

/** "dishWaterDetected" -> "dish water detected", for a key the definitions do not cover. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

export function useDeviceAlerts(
  dishStatus: DishStatusJson | null,
  dishConnection: DishConnectionState,
): DeviceAlerts {
  // The telemetry hook keeps the last good status on failure, so `dishStatus`
  // alone can't tell live from stale: an unreachable dish would render all 20 of
  // its checks green off an hours-old snapshot. Connection state is the truth,
  // read straight — the topbar reads the same value, and a debounced copy here
  // would mean the two disagree about the same fact for seconds at a time.
  // Flapping is a bug in whatever makes polls fail, not something to smooth over.
  const dishReachable = dishConnection !== "unreachable";
  // Collapsed to a string before the memo below: the status object is new every
  // poll, and reading it there would rebuild the alert list once a second.
  const presence = dishReachable ? routerPresence(dishStatus) : null;
  const trippedMeters = useTrippedMeters();
  const metersEnforceable = useMetersEnforceable();
  const [routerAlerts, setRouterAlerts] = useState<Record<string, boolean> | null>(null);
  const [routerReachable, setRouterReachable] = useState<boolean | null>(null);
  const [episodes, setEpisodes] = useState<AlertEpisodeJson[]>([]);
  const [historianUp, setHistorianUp] = useState<boolean | null>(null);
  // When this tab first saw each alert firing. The devices send bare booleans and
  // the client-raised ones (dish unreachable, recorder down) have no episode at
  // all, so for those this is the only start time that exists. It is honestly
  // "since you opened the app", not "since it began" — worded as "seen".
  const [firstSeenLog] = useState(createFirstSeenLog);
  const firstSeen = useSyncExternalStore(firstSeenLog.subscribe, firstSeenLog.snapshot);

  // Live router alerts, off the app's one shared router get_status poll. On
  // failure the last known alerts stand rather than reporting everything clear;
  // `reachable` is the flag the panel caveats with.
  useEffect(() => {
    return subscribeRouterStatus(({ status, reachable }) => {
      if (status !== null) setRouterAlerts(status.alerts ?? {});
      setRouterReachable(reachable);
    });
  }, []);

  // History + historian health: both come from the historian, and its silence is
  // an alert, not a failure to surface.
  useEffect(() => {
    let disposed = false;
    // "Recording has stopped" is a claim about a service, not about one request.
    // A single failure is a blip — a request that timed out against a busy
    // process, a reply that arrived malformed — and raising a warning off it
    // means the panel cries wolf on the one page whose whole job is to be
    // believed. Two in a row is a service that is actually not answering.
    let consecutiveFailures = 0;
    const load = async () => {
      try {
        const response = await apiRequest("/api/alerts", { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as { episodes?: AlertEpisodeJson[] };
        if (disposed) return;
        consecutiveFailures = 0;
        setEpisodes(body.episodes ?? []);
        setHistorianUp(true);
      } catch (error) {
        consecutiveFailures += 1;
        // Named, because the three things this catches — a timeout against a
        // busy process, a non-2xx, a malformed body — are not the same fault and
        // guessing between them after the fact is not possible.
        console.warn(
          `[alerts] /api/alerts failed (${consecutiveFailures} in a row): ${(error as Error).message}`,
        );
        if (!disposed && consecutiveFailures >= 2) setHistorianUp(false);
      }
    };
    void load();
    const timerId = window.setInterval(() => void load(), HISTORY_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  // Every check on both devices, clear and firing, in definition order — the
  // Status list. `active` is just the firing subset, plus the historian-down
  // synthetic, sorted worst-first for the notifications view.
  const statusList = useMemo<AlertState[]>(() => {
    // The dish latches noEthernetLink long after a flap ends: probed live
    // (2026-07-20), the flag stayed set 40+ minutes while the same reply
    // reported a working 1000 Mbps link. When the reply contradicts itself —
    // link flagged down AND a negotiated speed present — trust the speed. A
    // genuinely dead link makes the dish unreachable from the LAN, which
    // raises its own critical alert instead, so nothing real is silenced.
    const ethLinkUp = (dishStatus?.ethSpeedMbps ?? 0) > 0;
    const dishAlertList = resolveAlerts(DISH_ALERTS, dishStatus?.alerts, "dish").map((alert) =>
      alert.key === "noEthernetLink" && alert.active && ethLinkUp
        ? { ...alert, active: false }
        : alert,
    );
    return [...dishAlertList, ...resolveAlerts(ROUTER_ALERTS, routerAlerts ?? undefined, "router")];
  }, [dishStatus?.alerts, dishStatus?.ethSpeedMbps, routerAlerts]);

  const active = useMemo<AlertState[]>(() => {
    // A device that isn't answering leaves a stale snapshot, not an all-clear:
    // drop its checks and raise the unreachability itself instead.
    const firing = statusList.filter(
      (a) => a.active && (a.source === "dish" ? dishReachable : routerReachable !== false),
    );
    // Raised the moment a device stops answering, off the same value the filter
    // above uses. The connection status indicator and this panel therefore never
    // disagree: anything that turns the indicator red is an active alert in the
    // same render.
    const routerSilenceIsExpected = routerSilenceExpected(presence);
    const system = [
      ...(dishReachable ? [] : [DISH_UNREACHABLE]),
      ...(routerReachable === false && !routerSilenceIsExpected ? [ROUTER_UNREACHABLE] : []),
      // Never on a host that runs the recorder in its own process: there the
      // thing that would be down is the thing asking, so the alert can only ever
      // be a false alarm about a request that was slow.
      ...(historianUp === false && !recorderRunsInHostProcess() ? [HISTORIAN_DOWN] : []),
      ...trippedMeters.map((rule) => dataLimitAlert(rule, metersEnforceable)),
    ];
    return sortBySeverity([...firing, ...system]);
  }, [
    statusList,
    dishReachable,
    routerReachable,
    presence,
    historianUp,
    trippedMeters,
    metersEnforceable,
  ]);

  // Announce an alert opening or clearing. Seeded lazily so an alert already
  // firing when the app opens still gets announced once.
  //
  // announceAlert routes by where the user is: the in-app chime when this window
  // is in front (the sound control alone governs it), the OS notification when it
  // is not. On a host with its own always-on process — the desktop main, the
  // extension worker — that process posts the away-notification itself, so this
  // effect only ever sounds the chime for the window it lives in; there is no
  // double, because the host suppresses its own notification while the window is
  // in front.
  const previousActiveRef = useRef<Map<string, AlertState> | null>(null);
  useEffect(() => {
    const current = new Map(active.map((a) => [`${a.source}:${a.key}`, a]));
    const previous = previousActiveRef.current;
    if (previous !== null) {
      for (const [id, alert] of current) {
        if (alert.notify && !previous.has(id)) {
          announceAlert(
            alert.severity,
            false,
            `alert-${id}`,
            alertTitle(alert.source, false),
            alert.firing,
          );
        }
      }
      for (const [id, alert] of previous) {
        if (alert.notify && alert.notifyClear !== false && !current.has(id)) {
          // Distinct key so the clear is not swallowed by the onset's throttle.
          announceAlert(
            alert.severity,
            true,
            `alert-${id}-cleared`,
            alertTitle(alert.source, true),
            alert.ok,
          );
        }
      }
    }
    previousActiveRef.current = current;

    firstSeenLog.observe(current.keys());
  }, [active, firstSeenLog]);

  const history = useMemo<AlertHistoryEntry[]>(() => {
    return episodes.map((episode) => {
      const spec = SPEC_BY_SOURCE_KEY.get(`${episode.source}:${episode.key}`);
      return {
        source: episode.source,
        key: episode.key,
        startMs: episode.startMs,
        endMs: episode.endMs,
        // The alert's own message, verbatim — the same event reads the same way
        // live and in history. Advice is a separate field and stays out of here.
        label: episode.label ?? (spec ? spec.firing : humanizeKey(episode.key)),
        severity: episode.severity ?? spec?.severity ?? "advisory",
      };
    });
  }, [episodes]);

  return { active, statusList, history, routerReachable, historianUp, dishReachable, firstSeen };
}

function alertTitle(source: AlertSource, cleared: boolean): string {
  const device = source === "dish" ? "Dish" : source === "router" ? "Router" : "Dishylink";
  return cleared ? `${device} alert cleared` : `${device} alert`;
}
