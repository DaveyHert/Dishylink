// Polls the Starlink ROUTER's grpc-web endpoint (same Device service as the
// dish, /router proxy) for the connected-client list plus the WiFi config
// (SSIDs, mesh nodes, saved device names). Polled only while a router-backed
// surface (Network panel or Settings modal) is open.
//
// When that endpoint is silent — a kit in bypass, a viewer somewhere else — the
// same two reads are made through the user's Starlink account instead, which
// reaches the router without going near this network. Slower, and without the
// per-device throughput, but the roster is the roster.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DishClient,
  type WifiClientJson,
  type WifiNetworkConfigJson,
  type WifiStatusJson,
} from "@core/dishClient";
import type { ThroughputRates } from "@core/throughputTracker";
import type { TelemetrySample } from "@core/telemetry";
import { usageKey, type ClientUsageTotal } from "@core/clientUsage";
import { apiRequest } from "../lib/apiHost";
import { subscribeCloudSession } from "../lib/cloudHost";
import { setRouterClientName } from "../lib/routerClientUpdate";
import { subscribeRouterStatus } from "../lib/routerStatusFeed";
import {
  CloudNotConnectedError,
  fetchCloudRouterClients,
  fetchCloudRouterConfig,
} from "../lib/starlinkCloud";

// Roster only — names, signal, addresses, link rates. These change on the order
// of minutes, so there is nothing to gain from asking faster.
//
// Throughput deliberately does NOT come from here. The historian already polls
// this same RPC at 1 Hz and owns the byte-counter tracker; duplicating that in
// the browser meant two pollers hitting the router every second and two
// independent trackers, each able to land on the router's stats-refresh boundary
// differently. One recorder, read by every tab, is both cheaper and consistent.
export const CLIENTS_POLL_MS = 5_000;

/** Tail of the historian's 1 Hz window — small, incremental, purely local. */
const SAMPLES_POLL_MS = 1_000;

/** Consecutive silent polls before a router that was answering is called
 *  unreachable. One miss is the host that proxies the request stalling, not the
 *  router going away; each miss can cost a full timeout, so two is already ~10s. */
const MISSES_BEFORE_UNREACHABLE = 2;

/**
 * How often the roster is asked of the account, once the LAN cannot answer.
 *
 * Slower than the LAN's 5s: each poll is a round trip to starlink.com and back
 * down to the router, and it exists to keep a list of devices readable, not to
 * drive anything live. The 1 Hz per-device throughput stays LAN-only for the
 * same reason. It runs only while a router-backed panel is open.
 */
export const CLOUD_CLIENTS_POLL_MS = 15_000;

/** How many 1 Hz tails between asks for the monthly totals. They are a list of
 *  every device, and a month's odometer does not move meaningfully inside a
 *  second, so riding every fifth tick keeps them at the 5s roster cadence. */
const TOTALS_EVERY_TICKS = 5;
// Per-device throughput history. The router returns only a point-in-time rate,
// so the series is accumulated — but by the always-on historian, not here. This
// hook seeds from it (/api/clients) and then appends what it polls itself, so a
// reload or a closed panel no longer costs the user their history.
const HISTORY_WINDOW_MS = 6 * 3_600_000;

/** Whether a freshly fetched totals list carries nothing the current map does not
 *  already say, so the map can be kept by identity instead of rebuilt. */
function sameTotals(
  current: Map<string, ClientUsageTotal>,
  next: readonly ClientUsageTotal[],
): boolean {
  if (current.size !== next.length) return false;
  return next.every((total) => {
    const held = current.get(usageKey(total.clientId, total.macAddress));
    return (
      held !== undefined &&
      held.rxBytes === total.rxBytes &&
      held.txBytes === total.txBytes &&
      held.sinceMs === total.sinceMs &&
      held.lastSeenMs === total.lastSeenMs &&
      held.name === total.name
    );
  });
}

interface ClientMinuteJson {
  minute: number;
  /** Device key (clientId) — the historian attributes every row it serves, so
   *  this is always set on the wire even though older stored rows lack it. */
  key: string;
  macAddress: string;
  downMbps: number;
  upMbps: number;
}

/** One raw sample from the historian's 1 Hz window. */
interface ClientSampleJson {
  key: string;
  macAddress: string;
  atMs: number;
  downMbps: number;
  upMbps: number;
}

/** What the seed loaded, plus where the live tail must pick up from. */
export interface SeededClientHistory {
  history: Map<string, TelemetrySample[]>;
  /**
   * Newest raw sample the seed already holds, or 0 if it holds none.
   *
   * The tail passes this as `since=`, and the historian filters strictly newer,
   * so the first tail returns only what the seed missed. Without it the tail
   * starts from zero, refetches the whole window it was just handed, and
   * appends a second copy of every point — invisible on the chart, since the
   * duplicates land on identical timestamps, but wrong and twice the memory.
   */
  newestSampleMs: number;
}

/**
 * Backfill per-device series from the historian. Best-effort: without it we
 * simply start from this session's own polls, as before.
 *
 * Takes the historian's raw 1 Hz window (`samples`) rather than its per-minute
 * rows, so the seed arrives at the same cadence this hook then appends at. The
 * per-minute rows would draw ~15 points across the 15-minute chart and leave a
 * visible seam where the coarse seed met the live tail.
 */
export async function fetchPersistedClientHistory(): Promise<SeededClientHistory> {
  const history = new Map<string, TelemetrySample[]>();
  let newestSampleMs = 0;
  try {
    const response = await apiRequest("/api/clients?hours=6&samples=1", {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { history, newestSampleMs };
    const payload = (await response.json()) as {
      history?: ClientMinuteJson[];
      samples?: ClientSampleJson[];
    };
    const samples = payload.samples ?? [];
    // Where the raw window reaches, use it. Further back — only reachable in the
    // first stretch after a historian restart, since the window is twice the
    // chart's span — fall back to the per-minute rows. Coarse beats a "no data"
    // band over time that was in fact recorded.
    // Per device, not per MAC: devices sharing a masked MAC reach back different
    // distances, and one floor for the group would suppress the others' rows and
    // draw the gap as idle.
    const oldestRawByKey = new Map<string, number>();
    for (const sample of samples) {
      const known = oldestRawByKey.get(sample.key);
      if (known === undefined || sample.atMs < known) oldestRawByKey.set(sample.key, sample.atMs);
    }

    for (const row of payload.history ?? []) {
      const rawStartsMs = oldestRawByKey.get(row.key);
      // Skip anything the raw window already covers, so the two never double-plot.
      if (rawStartsMs !== undefined && row.minute * 1000 >= rawStartsMs) continue;
      const series = history.get(row.key) ?? [];
      series.push({
        timestampMs: row.minute * 1000,
        latencyMs: null,
        dropRate: 0,
        downlinkBps: row.downMbps * 1_000_000,
        uplinkBps: row.upMbps * 1_000_000,
        powerW: 0,
        routerLatencyMs: null,
        routerPingSuccessPercent: null,
      });
      history.set(row.key, series);
    }

    for (const sample of samples) {
      const series = history.get(sample.key) ?? [];
      series.push({
        timestampMs: sample.atMs,
        latencyMs: null,
        dropRate: 0,
        downlinkBps: sample.downMbps * 1_000_000,
        uplinkBps: sample.upMbps * 1_000_000,
        powerW: 0,
        routerLatencyMs: null,
        routerPingSuccessPercent: null,
      });
      history.set(sample.key, series);
      if (sample.atMs > newestSampleMs) newestSampleMs = sample.atMs;
    }
    // The two tiers were appended in separate passes; the chart assumes order.
    for (const series of history.values()) series.sort((a, b) => a.timestampMs - b.timestampMs);
  } catch {
    // historian down — fall through with whatever we can poll ourselves
  }
  return { history, newestSampleMs };
}

/**
 * Copy-on-write append of a batch of raw samples into the per-device history map.
 * Returns the newest timestamp seen (0 if `fresh` is empty).
 *
 * Every series this batch touches is replaced with a NEW array. That matters
 * because the hook only ever shallow-copies the Map (`new Map(history)`) to
 * signal a change, and consumers read series by key: a series mutated in place
 * keeps its reference, so a `useMemo` keyed on it — the per-device chart's
 * `windowTail` — never recomputes and the chart freezes until the panel is
 * remounted. `touched` lets a second sample for the same device in one batch
 * keep appending to that fresh array instead of copying it again.
 */
export function appendClientSamples(
  history: Map<string, TelemetrySample[]>,
  fresh: ClientSampleJson[],
): number {
  const touched = new Set<string>();
  let newestMs = 0;
  for (const sample of fresh) {
    const existing = history.get(sample.key);
    const series = touched.has(sample.key)
      ? existing! // already this batch's fresh array
      : existing
        ? existing.slice()
        : [];
    touched.add(sample.key);
    series.push({
      timestampMs: sample.atMs,
      latencyMs: null,
      dropRate: 0,
      downlinkBps: sample.downMbps * 1_000_000,
      uplinkBps: sample.upMbps * 1_000_000,
      powerW: 0,
      routerLatencyMs: null,
      routerPingSuccessPercent: null,
    });
    history.set(sample.key, series);
    if (sample.atMs > newestMs) newestMs = sample.atMs;
  }
  return newestMs;
}

export interface RouterNetwork {
  clients: WifiClientJson[];
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null; // null = still probing
  /**
   * Where the roster on screen came from, or null before either source has
   * answered.
   *
   * "cloud" is not a lesser copy of the same thing — it is the same list read
   * through the account — but it arrives every 20s and carries no per-device
   * throughput series, so a surface showing rates has to say which it is holding.
   */
  clientsSource: "lan" | "cloud" | null;
  /** Start reading the roster through the account. Lasts one outage: the LAN
   *  answering ends it, so the next silence asks again. */
  readRosterViaAccount: () => void;
  /** Whether the config on screen was read through the account because the LAN
   *  could not serve it. Independent of `clientsSource`: the config is fetched
   *  whenever the LAN is silent, the roster only when asked for. */
  wifiConfigViaAccount: boolean;
  /** How that read is going, for the control that asked for it. */
  accountRosterStatus: "idle" | "loading" | "failed";
  /** Why it failed, in words for the user. Null unless it did. */
  accountRosterError: string | null;
  /** Whether the historian answered its last tail, null before the first one. It
   *  serves the series and the router serves the roster, so this is not
   *  `routerReachable`. */
  historianAnswering: boolean | null;
  /** Rename a device on the router (persists across reconnects). */
  renameClient: (clientId: number, givenName: string) => Promise<void>;
  /** Rolling per-MAC throughput samples (down/up in bps) built from each poll. */
  throughputHistory: Map<string, TelemetrySample[]>;
  /** Live per-MAC rate — the newest sample from the historian's window, which
   *  computes it from byte-counter deltas rather than the router's averages. */
  rates: Map<string, ThroughputRates>;
  /** The rates as they stood when the current roster landed, for ordering a list
   *  of devices by throughput. Sorting on `rates` would reshuffle the list on
   *  every 1 Hz tick; this changes only when the roster does, so an order taken
   *  from it holds until there is a new set of devices to order. */
  ratesAtRoster: Map<string, ThroughputRates>;
  /** Per-MAC monthly usage total from the historian's odometer — survives the
   *  reconnects that reset the router's own per-client counter. */
  totals: Map<string, ClientUsageTotal>;
  /** From routerStatusFeed's shared poll — never poll the router directly here. */
  routerStatus: WifiStatusJson | null;
  /** Re-read the router's config now. For callers that just changed it, and so
   *  know it is stale without waiting for the router to go quiet and return. */
  refreshConfig: () => void;
}

export function useRouterNetwork(active: boolean): RouterNetwork {
  const [clients, setClients] = useState<WifiClientJson[]>([]);
  const [wifiConfig, setWifiConfig] = useState<WifiNetworkConfigJson | null>(null);
  const [routerReachable, setRouterReachable] = useState<boolean | null>(null);
  const [clientsSource, setClientsSource] = useState<"lan" | "cloud" | null>(null);
  const [historianAnswering, setHistorianAnswering] = useState<boolean | null>(null);
  const [accountRosterRequested, setAccountRosterRequested] = useState(false);
  const [accountRosterError, setAccountRosterError] = useState<string | null>(null);
  const [wifiConfigViaAccount, setWifiConfigViaAccount] = useState(false);
  /** Bumped on connect/disconnect, so a fallback that gave up for want of a
   *  session starts again the moment there is one. */
  const [cloudSession, setCloudSession] = useState(0);
  const [throughputHistory, setThroughputHistory] = useState<Map<string, TelemetrySample[]>>(
    new Map(),
  );
  const [rates, setRates] = useState<Map<string, ThroughputRates>>(new Map());
  const [ratesAtRoster, setRatesAtRoster] = useState<Map<string, ThroughputRates>>(new Map());
  const [totals, setTotals] = useState<Map<string, ClientUsageTotal>>(new Map());
  const [routerStatus, setRouterStatus] = useState<WifiStatusJson | null>(null);
  const ratesRef = useRef<Map<string, ThroughputRates>>(new Map());
  /** Newest sample already merged, so each tail asks only for what is new. */
  const lastSampleMsRef = useRef(0);
  const historyRef = useRef<Map<string, TelemetrySample[]>>(new Map());
  const clientRef = useRef<Promise<DishClient> | null>(null);
  /** Set while the poll effect is live, so a caller outside it can ask for a
   *  re-read without holding the router client itself. */
  const readConfigRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timerId = 0;
    let samplesTimerId = 0;
    let tailInFlight = false;

    (async () => {
      try {
        clientRef.current ??= DishClient.load("router");
        const routerClient = await clientRef.current;
        // Seed once from the historian before the first poll appends to it.
        if (historyRef.current.size === 0) {
          const { history: persisted, newestSampleMs } = await fetchPersistedClientHistory();
          if (disposed) return;
          if (persisted.size > 0) {
            historyRef.current = persisted;
            setThroughputHistory(new Map(persisted));
          }
          // Tell the tail where the seed ends, or it refetches the same window
          // and appends a duplicate of every point it was just given.
          lastSampleMsRef.current = Math.max(lastSampleMsRef.current, newestSampleMs);
        }
        // Bounded and non-overlapping for the same reason as every other poll:
        // an unanswering router must not stack hung requests until the
        // per-origin connection budget starves the dish poll too.
        let clientsInFlight = false;
        // Read on each return to answering, never on the poll: this router is a
        // small embedded box that has tripped its watchdog under added load. A kit
        // that went quiet can come back on a different subnet, with different
        // SSIDs, or off bypass, so the copy held from before the silence describes
        // something that no longer exists.
        let routerAnswering = false;
        // A router that has never answered has no silence to ride out, so it is
        // named at once; only one that was answering gets the misses above.
        let everAnswered = false;
        let misses = 0;
        const readConfig = () => {
          routerClient
            .getWifiConfig(AbortSignal.timeout(4_000))
            .then((config) => {
              if (disposed) return;
              setWifiConfig(config);
              setWifiConfigViaAccount(false);
            })
            .catch(() => {});
        };
        readConfigRef.current = readConfig;
        const pollClients = async () => {
          if (clientsInFlight) return;
          clientsInFlight = true;
          try {
            const clientList = await routerClient.getWifiClients(AbortSignal.timeout(4_000));
            if (disposed) return;
            setClients(clientList);
            setClientsSource("lan");
            setAccountRosterRequested(false);
            setAccountRosterError(null);
            // Captured with the roster, not read later: the pair is what an
            // ordering is taken from, and rates replace their map rather than
            // mutating it, so this stays the set that arrived with this roster.
            setRatesAtRoster(ratesRef.current);
            setRouterReachable(true);
            everAnswered = true;
            misses = 0;
            if (!routerAnswering) {
              routerAnswering = true;
              readConfig();
            }
          } catch {
            if (disposed) return;
            misses += 1;
            if (!everAnswered || misses >= MISSES_BEFORE_UNREACHABLE) {
              setRouterReachable(false);
              routerAnswering = false;
            }
          } finally {
            clientsInFlight = false;
          }
        };
        // Tail the historian's window: append what is new, drop what has aged
        // out. The historian is the only thing computing rates, so every tab
        // shows the same series and the router sees one poller, not one per tab.
        // Totals move slowly and are a per-device list; asking for them on every
        // 1 Hz tick would resend the whole set 5x more often than it can change
        // meaningfully. Ride along with every fifth tail instead.
        let tailTick = 0;
        const tailSamples = async () => {
          if (tailInFlight) return;
          tailInFlight = true;
          try {
            const since = lastSampleMsRef.current;
            const wantTotals = tailTick++ % TOTALS_EVERY_TICKS === 0;
            const response = await apiRequest(
              `/api/clients?samples=1${wantTotals ? "&totals=1" : ""}${since ? `&since=${since}` : "&hours=6"}`,
              { signal: AbortSignal.timeout(4_000) },
            );
            if (disposed) return;
            setHistorianAnswering(response.ok);
            if (!response.ok) return;
            const payload = (await response.json()) as {
              samples?: ClientSampleJson[];
              totals?: ClientUsageTotal[];
            };
            // Independent of whether new rate samples landed — an idle device
            // still has a total worth keeping current. Kept by identity when
            // nothing actually moved, so a quiet network stops re-rendering
            // every consumer of `totals` on each beat.
            const nextTotals = payload.totals;
            if (nextTotals) {
              setTotals((current) =>
                sameTotals(current, nextTotals)
                  ? current
                  : new Map(
                      nextTotals.map((total) => [
                        usageKey(total.clientId, total.macAddress),
                        total,
                      ]),
                    ),
              );
            }
            const fresh = payload.samples ?? [];
            if (fresh.length === 0) return;

            const history = historyRef.current;
            const newestMs = appendClientSamples(history, fresh);
            lastSampleMsRef.current = Math.max(lastSampleMsRef.current, newestMs);
            // Newest sample per device is the live reading the panel shows.
            const nextRates = new Map(ratesRef.current);
            for (const sample of fresh) {
              nextRates.set(sample.key, { downMbps: sample.downMbps, upMbps: sample.upMbps });
            }
            const cutoff = Date.now() - HISTORY_WINDOW_MS;
            for (const series of history.values()) {
              while (series.length > 0 && series[0].timestampMs < cutoff) series.shift();
            }
            ratesRef.current = nextRates;
            setRates(nextRates);
            setThroughputHistory(new Map(history));
          } catch {
            // Historian down: the roster still renders, just without a series.
            if (!disposed) setHistorianAnswering(false);
          } finally {
            tailInFlight = false;
          }
        };

        await pollClients();
        await tailSamples();
        timerId = window.setInterval(pollClients, CLIENTS_POLL_MS);
        samplesTimerId = window.setInterval(tailSamples, SAMPLES_POLL_MS);
      } catch {
        if (!disposed) setRouterReachable(false);
      }
    })();

    return () => {
      disposed = true;
      readConfigRef.current = () => {};
      window.clearInterval(timerId);
      window.clearInterval(samplesTimerId);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return subscribeRouterStatus((snapshot) => setRouterStatus(snapshot.status));
  }, [active]);

  useEffect(() => subscribeCloudSession(() => setCloudSession((count) => count + 1)), []);

  /**
   * Read the roster through the account while the LAN cannot serve it.
   *
   * The router reports its devices to Starlink whether or not this machine can
   * reach it, so the two cases the LAN read simply cannot cover — a kit in
   * bypass, and a viewer away from the network — are answered here. Runs only
   * while the LAN is silent and only once asked: the local read is faster, free,
   * and carries the throughput this one does not.
   */
  useEffect(() => {
    if (!active || routerReachable !== false || !accountRosterRequested) return;
    let disposed = false;
    let inFlight = false;
    let timerId = 0;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const roster = await fetchCloudRouterClients();
        if (disposed) return;
        setClients(roster);
        setClientsSource("cloud");
        setAccountRosterError(null);
      } catch (error) {
        if (disposed) return;
        // No session to ask with — stop rather than retry something only a
        // sign-in can fix. Connecting one bumps `cloudSession` and re-runs this.
        if (error instanceof CloudNotConnectedError) {
          window.clearInterval(timerId);
          setAccountRosterError("Connect your Starlink account first.");
        } else {
          setAccountRosterError(
            "Couldn't reach your Starlink account. Check this device's internet connection.",
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    timerId = window.setInterval(() => void poll(), CLOUD_CLIENTS_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [active, routerReachable, cloudSession, accountRosterRequested]);

  /**
   * Read the router's config through the account while the LAN cannot serve it.
   *
   * Unasked, unlike the roster: nothing here is swapped out from under a reader
   * mid-glance. The surfaces showing it (SSIDs, mesh nodes, the subnet) are the
   * same facts from either source, and they are simply absent without it. Once
   * per stretch of silence, since each read is a trip through the account and a
   * change made from here re-reads through `refreshConfig`.
   */
  useEffect(() => {
    if (!active || routerReachable !== false) return;
    let disposed = false;
    let timerId = 0;

    // Retried until one read lands, then left alone. A single attempt would
    // leave the settings that show this empty for the rest of an outage that
    // began while the account happened to be out of reach.
    const read = async () => {
      const config = await fetchCloudRouterConfig().catch(() => null);
      if (disposed || !config) return;
      setWifiConfig(config);
      setWifiConfigViaAccount(true);
      window.clearInterval(timerId);
    };

    void read();
    timerId = window.setInterval(() => void read(), CLOUD_CLIENTS_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [active, routerReachable, cloudSession]);

  const readRosterViaAccount = useCallback(() => {
    setAccountRosterError(null);
    setAccountRosterRequested(true);
  }, []);

  const accountRosterStatus = !accountRosterRequested
    ? "idle"
    : accountRosterError
      ? "failed"
      : clientsSource === "cloud"
        ? "idle"
        : "loading";

  const renameClient = useCallback(async (clientId: number, givenName: string) => {
    // Current firmware answers every LAN write with grpc status 7, so this goes
    // through the account session like the other router writes — see LOCAL-API.md.
    await setRouterClientName(clientId, givenName);
    // reflect immediately; the next poll confirms from the router
    setClients((current) =>
      current.map((client) => (client.clientId === clientId ? { ...client, givenName } : client)),
    );
  }, []);

  const refreshConfig = useCallback(() => {
    // Re-read from whatever is actually serving this roster: the LAN reader is
    // silent in exactly the case the fallback exists for.
    if (clientsSource === "cloud") {
      void fetchCloudRouterConfig()
        .then((config) => config && setWifiConfig(config))
        .catch(() => {});
      return;
    }
    readConfigRef.current();
  }, [clientsSource]);

  return {
    clients,
    wifiConfig,
    routerReachable,
    clientsSource,
    historianAnswering,
    readRosterViaAccount,
    accountRosterStatus,
    accountRosterError,
    wifiConfigViaAccount,
    renameClient,
    throughputHistory,
    rates,
    ratesAtRoster,
    totals,
    routerStatus,
    refreshConfig,
  };
}
