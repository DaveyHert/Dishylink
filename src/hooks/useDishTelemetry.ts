// Polling loop against the dish: status every 2s, history every 5s,
// obstruction map every 30s. All state a component needs comes out of here.

import { useEffect, useRef, useState } from "react";
import {
  DishClient,
  type DishStatusJson,
  type DishDeviceInfoJson,
  type DishObstructionMapJson,
  type DishLocationJson,
} from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";
import { subscribeRouterStatus } from "../lib/routerStatusFeed";
import { apiRequest } from "../lib/apiHost";
import {
  TelemetryAccumulator,
  decodeOutageEvents,
  readRouterLatencyMs,
  readRouterPingSuccessPercent,
  type TelemetrySample,
  type OutageEvent,
  type RouterReadings,
} from "@core/telemetry";

/**
 * Backfill from the always-on historian so a page reload never resets the
 * charts. Best-effort: if the historian is down we just start from the dish's
 * own ~15-minute ring buffer like before.
 */
async function fetchPersistedSamples(): Promise<TelemetrySample[]> {
  try {
    const response = await apiRequest("/api/samples?minutes=360", {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { samples?: TelemetrySample[] };
    return payload.samples ?? [];
  } catch {
    return [];
  }
}

// The dish's history ring advances once a second, so 1s is its true sample
// rate — polling faster just reads the same value twice.
const STATUS_POLL_MS = 1_000;
// 1s, matching the dish's own sample clock. Every poll returns the whole 900-
// sample ring, so this is not about resolution — that is already 1 Hz at any
// poll rate — but about freshness: at 5s the chart's leading edge jumped five
// samples at a time while the stat tiles (polled every second) moved smoothly,
// which reads as a laggy chart rather than a live one.
const HISTORY_POLL_MS = 1_000;
const OBSTRUCTION_POLL_MS = 30_000;
const LOCATION_RETRY_MS = 60_000; // picks up the app-side toggle without a reload
const SAMPLE_RETENTION_MS = 6 * 3_600_000; // keep six hours of clock, gaps included
// How long the link must stay unanswered before the UI treats it as offline, so a
// fresh load's opening `connecting` and short reconnect blips don't flip the live
// surfaces to their offline state and back.
const STALE_AFTER_MS = 5_000;

export type DishConnectionState = "connecting" | "online" | "unreachable";

export interface DishTelemetry {
  connectionState: DishConnectionState;
  /** connectionState has been non-online for STALE_AFTER_MS — the debounced flag
   *  the live surfaces gate their offline state on, immune to blips and cold start. */
  stale: boolean;
  deviceInfo: DishDeviceInfoJson | null;
  status: DishStatusJson | null;
  samples: TelemetrySample[];
  outageEvents: OutageEvent[];
  obstructionMap: DishObstructionMapJson | null;
  /** Dish GPS position, once the Starlink app's local-access toggle allows it. */
  dishLocation: DishLocationJson | null;
  /** True while get_location returns PermissionDenied (toggle off in the app). */
  locationDenied: boolean;
  /** When the dish last answered, so a stale card can say how old its facts are
   *  rather than only that they are old. Null until the first reply. */
  lastStatusAtMs: number | null;
}

export function useDishTelemetry(): DishTelemetry {
  const [connectionState, setConnectionState] = useState<DishConnectionState>("connecting");
  const [stale, setStale] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DishDeviceInfoJson | null>(null);
  const [status, setStatus] = useState<DishStatusJson | null>(null);
  const [lastStatusAtMs, setLastStatusAtMs] = useState<number | null>(null);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [outageEvents, setOutageEvents] = useState<OutageEvent[]>([]);
  const [obstructionMap, setObstructionMap] = useState<DishObstructionMapJson | null>(null);
  const [dishLocation, setDishLocation] = useState<DishLocationJson | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const accumulatorRef = useRef(new TelemetryAccumulator(SAMPLE_RETENTION_MS));

  // Debounce offline: it trips only after the link has stayed unanswered for
  // STALE_AFTER_MS, and clears on reconnect — a blip's timer is cleared before it
  // fires. Both sides go through the timer (online at 0ms) so neither sets state
  // synchronously in the effect.
  useEffect(() => {
    const offline = connectionState !== "online";
    const timerId = window.setTimeout(() => setStale(offline), offline ? STALE_AFTER_MS : 0);
    return () => window.clearTimeout(timerId);
  }, [connectionState]);

  useEffect(() => {
    let disposed = false;
    let client: DishClient | null = null;
    const timerIds: number[] = [];

    // Every poll is bounded and never overlaps itself. An unplugged dish leaves
    // the proxy's TCP connect hanging for the OS timeout (~75s); unbounded polls
    // stack up behind it every interval until they exhaust the browser's
    // ~6-connections-per-origin budget, and then the router poll and the
    // historian fetches can't get a socket either — the app reports a router and
    // recorder outage that isn't happening. Same rule the router poll in
    // useDeviceAlerts already follows.
    let statusInFlight = false;
    const pollStatus = async () => {
      if (!client || statusInFlight) return;
      statusInFlight = true;
      try {
        const dishStatus = await client.getStatus(AbortSignal.timeout(4_000));
        if (disposed) return;
        setStatus(dishStatus);
        setLastStatusAtMs(Date.now());
        setConnectionState("online");
      } catch {
        if (!disposed) setConnectionState("unreachable");
      } finally {
        statusInFlight = false;
      }
    };

    // The router's second opinion on latency and ping success, stamped onto the
    // samples each history poll appends. The historian is what makes these real
    // series — it samples and persists the same readings, so the 1H and 6H
    // windows have something to draw; these cover only the live edge, the
    // stretch since the page opened that no seed can reach.
    //
    // Both readings ride the app's one shared get_status poll (routerStatusFeed)
    // — this hook costs the router nothing. Ping success comes from that reply's
    // popPingDropRate5m, the router's own rolling five-minute measure; it must
    // never be sourced from get_ping (1009), which rebooted the router at every
    // cadence it was tried at (2026-07-20). A browser tab must never be what
    // destabilises the router it is monitoring.
    const routerReadings: RouterReadings = { latencyMs: null, pingSuccessPercent: null };
    const unsubscribeRouterStatus = subscribeRouterStatus(({ status, reachable }) => {
      // An unreachable router leaves the series empty rather than repeating a
      // stale reading; it is not an app error.
      routerReadings.latencyMs =
        reachable && status ? readRouterLatencyMs(status.popPingLatencyMs) : null;
      routerReadings.pingSuccessPercent =
        reachable && status ? readRouterPingSuccessPercent(status.popPingDropRate5m) : null;
    });

    let historyInFlight = false;
    const pollHistory = async () => {
      if (!client || historyInFlight) return;
      historyInFlight = true;
      try {
        const history = await client.getHistory(AbortSignal.timeout(4_000));
        if (disposed) return;
        setSamples([...accumulatorRef.current.ingest(history, Date.now(), routerReadings)]);
        setOutageEvents(decodeOutageEvents(history));
      } catch {
        // status polling owns the connection indicator
      } finally {
        historyInFlight = false;
      }
    };

    let obstructionInFlight = false;
    const pollObstructionMap = async () => {
      if (!client || obstructionInFlight) return;
      obstructionInFlight = true;
      try {
        const skyMap = await client.getObstructionMap(AbortSignal.timeout(10_000));
        if (!disposed) setObstructionMap(skyMap);
      } catch {
        // non-fatal; keep the last map
      } finally {
        obstructionInFlight = false;
      }
    };

    let locationResolved = false;
    const pollLocation = async () => {
      if (!client || locationResolved) return;
      try {
        const location = await client.getLocation(AbortSignal.timeout(10_000));
        if (disposed) return;
        if (location.lla?.lat !== undefined) {
          locationResolved = true;
          setDishLocation(location);
          setLocationDenied(false);
        }
      } catch (locationError) {
        if (!disposed && locationError instanceof GrpcWebError && locationError.grpcStatus === 7) {
          setLocationDenied(true);
        }
      }
    };

    (async () => {
      try {
        const [loadedClient, persistedSamples] = await Promise.all([
          DishClient.load(),
          fetchPersistedSamples(),
        ]);
        client = loadedClient;
        if (disposed) return;
        if (persistedSamples.length > 0) {
          setSamples([...accumulatorRef.current.seed(persistedSamples)]);
        }
        client
          .getDeviceInfo(AbortSignal.timeout(4_000))
          .then((info) => !disposed && setDeviceInfo(info))
          .catch(() => {});
        await Promise.all([pollStatus(), pollHistory(), pollObstructionMap(), pollLocation()]);
        timerIds.push(window.setInterval(pollStatus, STATUS_POLL_MS));
        timerIds.push(window.setInterval(pollHistory, HISTORY_POLL_MS));
        timerIds.push(window.setInterval(pollObstructionMap, OBSTRUCTION_POLL_MS));
        timerIds.push(window.setInterval(pollLocation, LOCATION_RETRY_MS));
      } catch {
        if (!disposed) setConnectionState("unreachable");
      }
    })();

    return () => {
      disposed = true;
      unsubscribeRouterStatus();
      timerIds.forEach((timerId) => window.clearInterval(timerId));
    };
  }, []);

  return {
    connectionState,
    stale,
    deviceInfo,
    status,
    samples,
    outageEvents,
    obstructionMap,
    dishLocation,
    locationDenied,
    lastStatusAtMs,
  };
}
