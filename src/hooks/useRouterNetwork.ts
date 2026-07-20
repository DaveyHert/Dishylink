// Polls the Starlink ROUTER's grpc-web endpoint (same Device service as the
// dish, /router proxy) for the connected-client list plus the WiFi config
// (SSIDs, mesh nodes, saved device names). Polled only while a router-backed
// surface (Network sheet or Settings modal) is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { DishClient, type WifiClientJson, type WifiNetworkConfigJson } from "../lib/dishClient";
import type { ThroughputRates } from "../lib/throughputTracker";
import type { TelemetrySample } from "../lib/telemetry";
import type { ClientUsageTotal } from "../lib/clientUsage";

// Roster only — names, signal, addresses, link rates. These change on the order
// of minutes, so there is nothing to gain from asking faster.
//
// Throughput deliberately does NOT come from here. The collector already polls
// this same RPC at 1 Hz and owns the byte-counter tracker; duplicating that in
// the browser meant two pollers hitting the router every second and two
// independent trackers, each able to land on the router's stats-refresh boundary
// differently. One recorder, read by every tab, is both cheaper and consistent.
const CLIENTS_POLL_MS = 5_000;

/** Tail of the collector's 1 Hz window — small, incremental, purely local. */
const SAMPLES_POLL_MS = 1_000;

/** How many 1 Hz tails between asks for the monthly totals. They are a list of
 *  every device, and a month's odometer does not move meaningfully inside a
 *  second, so riding every fifth tick keeps them at the 5s roster cadence. */
const TOTALS_EVERY_TICKS = 5;
// Per-device throughput history. The router returns only a point-in-time rate,
// so the series is accumulated — but by the always-on collector, not here. This
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
    const held = current.get(total.macAddress);
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
  macAddress: string;
  downMbps: number;
  upMbps: number;
}

/** One raw sample from the collector's 1 Hz window. */
interface ClientSampleJson {
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
   * The tail passes this as `since=`, and the collector filters strictly newer,
   * so the first tail returns only what the seed missed. Without it the tail
   * starts from zero, refetches the whole window it was just handed, and
   * appends a second copy of every point — invisible on the chart, since the
   * duplicates land on identical timestamps, but wrong and twice the memory.
   */
  newestSampleMs: number;
}

/**
 * Backfill per-device series from the collector. Best-effort: without it we
 * simply start from this session's own polls, as before.
 *
 * Takes the collector's raw 1 Hz window (`samples`) rather than its per-minute
 * rows, so the seed arrives at the same cadence this hook then appends at. The
 * per-minute rows would draw ~15 points across the 15-minute chart and leave a
 * visible seam where the coarse seed met the live tail.
 */
export async function fetchPersistedClientHistory(): Promise<SeededClientHistory> {
  const history = new Map<string, TelemetrySample[]>();
  let newestSampleMs = 0;
  try {
    const response = await fetch("/api/clients?hours=6&samples=1", {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { history, newestSampleMs };
    const payload = (await response.json()) as {
      history?: ClientMinuteJson[];
      samples?: ClientSampleJson[];
    };
    const samples = payload.samples ?? [];
    // Where the raw window reaches, use it. Further back — only reachable in the
    // first stretch after a collector restart, since the window is twice the
    // chart's span — fall back to the per-minute rows. Coarse beats a "no data"
    // band over time that was in fact recorded.
    const oldestRawByMac = new Map<string, number>();
    for (const sample of samples) {
      const known = oldestRawByMac.get(sample.macAddress);
      if (known === undefined || sample.atMs < known) oldestRawByMac.set(sample.macAddress, sample.atMs);
    }

    for (const row of payload.history ?? []) {
      const rawStartsMs = oldestRawByMac.get(row.macAddress);
      // Skip anything the raw window already covers, so the two never double-plot.
      if (rawStartsMs !== undefined && row.minute * 1000 >= rawStartsMs) continue;
      const series = history.get(row.macAddress) ?? [];
      series.push({
        timestampMs: row.minute * 1000,
        latencyMs: null,
        dropRate: 0,
        downlinkBps: row.downMbps * 1_000_000,
        uplinkBps: row.upMbps * 1_000_000,
        powerW: 0,
      });
      history.set(row.macAddress, series);
    }

    for (const sample of samples) {
      const series = history.get(sample.macAddress) ?? [];
      series.push({
        timestampMs: sample.atMs,
        latencyMs: null,
        dropRate: 0,
        downlinkBps: sample.downMbps * 1_000_000,
        uplinkBps: sample.upMbps * 1_000_000,
        powerW: 0,
      });
      history.set(sample.macAddress, series);
      if (sample.atMs > newestSampleMs) newestSampleMs = sample.atMs;
    }
    // The two tiers were appended in separate passes; the chart assumes order.
    for (const series of history.values()) series.sort((a, b) => a.timestampMs - b.timestampMs);
  } catch {
    // collector down — fall through with whatever we can poll ourselves
  }
  return { history, newestSampleMs };
}

/**
 * Copy-on-write append of a batch of raw samples into the per-MAC history map.
 * Returns the newest timestamp seen (0 if `fresh` is empty).
 *
 * Every series this batch touches is replaced with a NEW array. That matters
 * because the hook only ever shallow-copies the Map (`new Map(history)`) to
 * signal a change, and consumers read series by key: a series mutated in place
 * keeps its reference, so a `useMemo` keyed on it — the per-device chart's
 * `windowTail` — never recomputes and the chart freezes until the panel is
 * remounted. `touched` lets a second sample for the same MAC in one batch keep
 * appending to that fresh array instead of copying it again.
 */
export function appendClientSamples(
  history: Map<string, TelemetrySample[]>,
  fresh: ClientSampleJson[],
): number {
  const touched = new Set<string>();
  let newestMs = 0;
  for (const sample of fresh) {
    const existing = history.get(sample.macAddress);
    const series = touched.has(sample.macAddress)
      ? existing! // already this batch's fresh array
      : existing
        ? existing.slice()
        : [];
    touched.add(sample.macAddress);
    series.push({
      timestampMs: sample.atMs,
      latencyMs: null,
      dropRate: 0,
      downlinkBps: sample.downMbps * 1_000_000,
      uplinkBps: sample.upMbps * 1_000_000,
      powerW: 0,
    });
    history.set(sample.macAddress, series);
    if (sample.atMs > newestMs) newestMs = sample.atMs;
  }
  return newestMs;
}

export interface RouterNetwork {
  clients: WifiClientJson[];
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null; // null = still probing
  /** Rename a device on the router (persists across reconnects). */
  renameClient: (macAddress: string, givenName: string) => Promise<void>;
  /** Rolling per-MAC throughput samples (down/up in bps) built from each poll. */
  throughputHistory: Map<string, TelemetrySample[]>;
  /** Live per-MAC rate — the newest sample from the collector's window, which
   *  computes it from byte-counter deltas rather than the router's averages. */
  rates: Map<string, ThroughputRates>;
  /** Per-MAC monthly usage total from the collector's odometer — survives the
   *  reconnects that reset the router's own per-client counter. */
  totals: Map<string, ClientUsageTotal>;
}

export function useRouterNetwork(active: boolean): RouterNetwork {
  const [clients, setClients] = useState<WifiClientJson[]>([]);
  const [wifiConfig, setWifiConfig] = useState<WifiNetworkConfigJson | null>(null);
  const [routerReachable, setRouterReachable] = useState<boolean | null>(null);
  const [throughputHistory, setThroughputHistory] = useState<Map<string, TelemetrySample[]>>(new Map());
  const [rates, setRates] = useState<Map<string, ThroughputRates>>(new Map());
  const [totals, setTotals] = useState<Map<string, ClientUsageTotal>>(new Map());
  const ratesRef = useRef<Map<string, ThroughputRates>>(new Map());
  /** Newest sample already merged, so each tail asks only for what is new. */
  const lastSampleMsRef = useRef(0);
  const historyRef = useRef<Map<string, TelemetrySample[]>>(new Map());
  const clientRef = useRef<Promise<DishClient> | null>(null);

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
        // Seed once from the collector before the first poll appends to it.
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
        const pollClients = async () => {
          if (clientsInFlight) return;
          clientsInFlight = true;
          try {
            const clientList = await routerClient.getWifiClients(AbortSignal.timeout(4_000));
            if (disposed) return;
            setClients(clientList);
            setRouterReachable(true);
          } catch {
            if (!disposed) setRouterReachable(false);
          } finally {
            clientsInFlight = false;
          }
        };
        routerClient
          .getWifiConfig(AbortSignal.timeout(4_000))
          .then((config) => !disposed && setWifiConfig(config))
          .catch(() => {});
        // Tail the collector's window: append what is new, drop what has aged
        // out. The collector is the only thing computing rates, so every tab
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
            const response = await fetch(
              `/api/clients?samples=1${wantTotals ? "&totals=1" : ""}${since ? `&since=${since}` : "&hours=6"}`,
              { signal: AbortSignal.timeout(4_000) },
            );
            if (!response.ok || disposed) return;
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
                  : new Map(nextTotals.map((total) => [total.macAddress, total])),
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
              nextRates.set(sample.macAddress, { downMbps: sample.downMbps, upMbps: sample.upMbps });
            }
            const cutoff = Date.now() - HISTORY_WINDOW_MS;
            for (const series of history.values()) {
              while (series.length > 0 && series[0].timestampMs < cutoff) series.shift();
            }
            ratesRef.current = nextRates;
            setRates(nextRates);
            setThroughputHistory(new Map(history));
          } catch {
            // Collector down: the roster still renders, just without a series.
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
      window.clearInterval(timerId);
      window.clearInterval(samplesTimerId);
    };
  }, [active]);

  const renameClient = useCallback(async (macAddress: string, givenName: string) => {
    clientRef.current ??= DishClient.load("router");
    const routerClient = await clientRef.current;
    // Bounded so a dead router fails the Save button instead of hanging it.
    await routerClient.setClientGivenName(macAddress, givenName, AbortSignal.timeout(10_000));
    // reflect immediately; the next poll confirms from the router
    setClients((current) =>
      current.map((client) => (client.macAddress === macAddress ? { ...client, givenName } : client)),
    );
  }, []);

  return { clients, wifiConfig, routerReachable, renameClient, throughputHistory, rates, totals };
}
