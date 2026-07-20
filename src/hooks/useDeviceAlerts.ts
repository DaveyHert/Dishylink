// Live alert state for the whole setup, owned by the browser.
//
// Both the dish and the router report their alerts as live booleans on
// get_status, and the Starlink app reads them straight off each device. So does
// this: dish alerts come from the telemetry poll already running (2s); router
// alerts from a light get_status poll this hook runs itself (5s). Neither goes
// through the collector — the thing whose job is to warn you must not depend on
// a background process that can die. Notifications fire from this live diff too,
// which is why this replaces useThermalNotifications (a superset: all notifiable
// alerts on both devices, not just the three thermal ones).
//
// The collector is only a historian. It records episodes so an alert that came
// and went while no browser was open still shows up under History — and its own
// health is surfaced as an alert (a dead-man's switch), never as a dependency.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DishStatusJson } from "../lib/dishClient";
import { subscribeRouterStatus } from "../lib/routerStatusFeed";
import type { DishConnectionState } from "./useDishTelemetry";
import {
  DISH_ALERTS,
  ROUTER_ALERTS,
  resolveAlerts,
  sortBySeverity,
  type AlertSpec,
  type AlertSource,
  type AlertState,
} from "../lib/dishAlerts";
import { sendNotification } from "../lib/notifications";
import { playAlertSound } from "../lib/alertSound";

const HISTORY_POLL_MS = 30_000;

/** An episode as the collector serves it on /api/alerts. */
interface AlertEpisodeJson {
  source: AlertSource;
  key: string;
  startMs: number;
  endMs: number | null;
}

export interface AlertHistoryEntry {
  source: AlertSource;
  key: string;
  startMs: number;
  endMs: number | null;
  /** Catalogue wording, or a humanised raw key if the firmware added one we don't know. */
  label: string;
  severity: AlertState["severity"];
}

/** When this tab first saw an alert firing. The devices send bare booleans and
 *  the client-raised ones (dish unreachable, recorder down) have no episode at
 *  all, so for those this is the only start time that exists. It is honestly
 *  "since you opened the app", not "since it began" — worded as "seen". */
function useFirstSeen(active: AlertState[]): Map<string, number> {
  const firstSeenRef = useRef(new Map<string, number>());
  const ids = active.map((a) => `${a.source}:${a.key}`).join("|");
  return useMemo(() => {
    const now = Date.now();
    const current = new Set(active.map((a) => `${a.source}:${a.key}`));
    for (const id of current) if (!firstSeenRef.current.has(id)) firstSeenRef.current.set(id, now);
    // Forget cleared alerts, so a recurrence is timed from its new onset.
    for (const id of [...firstSeenRef.current.keys()]) if (!current.has(id)) firstSeenRef.current.delete(id);
    return new Map(firstSeenRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
}

export interface DeviceAlerts {
  /** Everything firing right now, worst first — includes a synthetic collector-down alert. */
  active: AlertState[];
  /** Every check on both devices, clear and firing, in catalogue order — the Status list. */
  statusList: AlertState[];
  /** Past episodes from the collector, newest first. Empty when the collector is down. */
  history: AlertHistoryEntry[];
  /** null while first probing; false when the router get_status poll is failing. */
  routerReachable: boolean | null;
  /** null while first probing; false when the collector (history) is unreachable. */
  collectorUp: boolean | null;
  /** False when the dish isn't answering: its checks below are the last known
   *  values, not live, and must not be read as "all clear". */
  dishReachable: boolean;
  /** "source:key" -> when this tab first saw it firing. The fallback start time
   *  for alerts with no recorded episode. */
  firstSeen: Map<string, number>;
}

/** The dish not answering at all. Not one of its 20 alerts — those only exist in
 *  a get_status reply, so the one condition that silences them can never be one
 *  of them. Only the client can see it, so only the client can raise it. */
const DISH_UNREACHABLE: AlertState = {
  key: "dishUnreachable",
  source: "system",
  ok: "Dish is answering",
  firing: "Dish isn’t answering",
  advice: "Check that the dish has power and that its cable to the router is seated at both ends.",
  severity: "critical",
  notify: true,
  active: true,
};

/** Same shape for the router: its 21 alerts only exist inside its reply. */
const ROUTER_UNREACHABLE: AlertState = {
  key: "routerUnreachable",
  source: "system",
  ok: "Router is answering",
  firing: "Router isn’t answering",
  severity: "warning",
  notify: true,
  active: true,
};

/** Conditions the collector records about a device rather than off it. Their
 *  wording has to live here too, or history shows a raw key. */
const SYSTEM_ALERTS: AlertSpec[] = [
  {
    key: "dishUnreachable",
    ok: "Dish is answering",
    firing: "Dish isn’t answering",
    advice: "Check that the dish has power and that its cable to the router is seated at both ends.",
    severity: "critical",
    notify: true,
  },
  {
    key: "routerUnreachable",
    ok: "Router is answering",
    firing: "Router isn’t answering",
    severity: "warning",
    notify: true,
  },
  // Recorded by the recorder about itself: a boot that finds its heartbeat
  // stale logs the gap, so History can say "not recorded" instead of implying
  // "nothing happened". Never fires live — COLLECTOR_DOWN covers the present.
  {
    key: "recorderOff",
    ok: "Recording ran continuously",
    firing: "Recording was off — anything in this gap went unrecorded",
    severity: "advisory",
  },
];

const SPEC_BY_SOURCE_KEY = new Map<string, AlertSpec>([
  ...DISH_ALERTS.map((spec) => [`dish:${spec.key}`, spec] as const),
  ...ROUTER_ALERTS.map((spec) => [`router:${spec.key}`, spec] as const),
  ...SYSTEM_ALERTS.map((spec) => [`system:${spec.key}`, spec] as const),
]);

/** The collector being down is itself an alert: recording has silently stopped. */
const COLLECTOR_DOWN: AlertState = {
  key: "collectorDown",
  source: "system",
  ok: "History recorder running",
  firing: "History recorder is down — live alerts still work, but nothing is being recorded",
  severity: "warning",
  notify: true,
  active: true,
};

/** "dishWaterDetected" -> "dish water detected", for a key no catalogue knows. */
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
  const [routerAlerts, setRouterAlerts] = useState<Record<string, boolean> | null>(null);
  const [routerReachable, setRouterReachable] = useState<boolean | null>(null);
  const [episodes, setEpisodes] = useState<AlertEpisodeJson[]>([]);
  const [collectorUp, setCollectorUp] = useState<boolean | null>(null);

  // Live router alerts, off the app's one shared router get_status poll. On
  // failure the last known alerts stand rather than reporting everything clear;
  // `reachable` is the flag the panel caveats with.
  useEffect(() => {
    return subscribeRouterStatus(({ status, reachable }) => {
      if (status !== null) setRouterAlerts(status.alerts ?? {});
      setRouterReachable(reachable);
    });
  }, []);

  // History + collector health: both come from the collector, and its silence is
  // an alert, not a failure to surface.
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch("/api/alerts", { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as { episodes?: AlertEpisodeJson[] };
        if (disposed) return;
        setEpisodes(body.episodes ?? []);
        setCollectorUp(true);
      } catch {
        // Only a failure to connect at all means it is down.
        if (!disposed) setCollectorUp(false);
      }
    };
    void load();
    const timerId = window.setInterval(() => void load(), HISTORY_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  // Every check on both devices, clear and firing, in catalogue order — the
  // Status list. `active` is just the firing subset, plus the collector-down
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
    // An unreachable dish means its 20 checks are a stale snapshot, not "clear":
    // drop them and raise the unreachability itself instead.
    // A device that isn't answering leaves a stale snapshot, not an all-clear:
    // drop its checks and raise the unreachability itself instead.
    const firing = statusList.filter(
      (a) =>
        a.active &&
        (a.source === "dish" ? dishReachable : routerReachable !== false),
    );
    const system = [
      ...(dishReachable ? [] : [DISH_UNREACHABLE]),
      ...(routerReachable === false ? [ROUTER_UNREACHABLE] : []),
      ...(collectorUp === false ? [COLLECTOR_DOWN] : []),
    ];
    return sortBySeverity([...firing, ...system]);
  }, [statusList, dishReachable, routerReachable, collectorUp]);

  // Fire a notification when an alert opens or clears. Seeded lazily so an alert
  // already firing when the app opens still gets announced once.
  const previousActiveRef = useRef<Map<string, AlertState> | null>(null);
  useEffect(() => {
    const current = new Map(active.map((a) => [`${a.source}:${a.key}`, a]));
    const previous = previousActiveRef.current;
    if (previous !== null) {
      // The chime is the app's own alert channel and stands alone — it fires
      // whether or not browser notifications are enabled. The notification is
      // optional escalation on top. Each keeps its own per-alert throttle, so
      // disabling or blocking one never silences the other.
      for (const [id, alert] of current) {
        if (alert.notify && !previous.has(id)) {
          playAlertSound(alert.severity, false, `alert-${id}`);
          sendNotification(`alert-${id}`, alertTitle(alert.source, false), alert.firing);
        }
      }
      for (const [id, alert] of previous) {
        if (alert.notify && !current.has(id)) {
          // Distinct key so the clear is not swallowed by the onset's throttle.
          playAlertSound(alert.severity, true, `alert-${id}-cleared`);
          sendNotification(`alert-${id}-cleared`, alertTitle(alert.source, true), alert.ok);
        }
      }
    }
    previousActiveRef.current = current;
  }, [active]);

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
        label: spec ? spec.firing : humanizeKey(episode.key),
        severity: spec ? spec.severity : "advisory",
      };
    });
  }, [episodes]);

  const firstSeen = useFirstSeen(active);

  return { active, statusList, history, routerReachable, collectorUp, dishReachable, firstSeen };
}

function alertTitle(source: AlertSource, cleared: boolean): string {
  const device = source === "dish" ? "Dish" : source === "router" ? "Router" : "DishyLink";
  return cleared ? `${device} alert cleared` : `${device} alert`;
}
