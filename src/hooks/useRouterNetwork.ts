// Polls the Starlink ROUTER's grpc-web endpoint (same Device service as the
// dish, /router proxy) for the connected-client list plus the WiFi config
// (SSIDs, mesh nodes, saved device names). Polled only while a router-backed
// surface (Network sheet or Settings modal) is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { DishClient, throughputMbps, type WifiClientJson, type WifiNetworkConfigJson } from "../lib/dishClient";
import type { TelemetrySample } from "../lib/telemetry";

const CLIENTS_POLL_MS = 5_000;
// Per-device throughput history. The router returns only a point-in-time rate,
// so the series is accumulated — but by the always-on collector, not here. This
// hook seeds from it (/api/clients) and then appends what it polls itself, so a
// reload or a closed panel no longer costs the user their history.
const HISTORY_WINDOW_MS = 6 * 3_600_000;

interface ClientMinuteJson {
  minute: number;
  macAddress: string;
  downMbps: number;
  upMbps: number;
}

/** Backfill per-device series from the collector. Best-effort: without it we
 *  simply start from this session's own polls, as before. */
async function fetchPersistedClientHistory(): Promise<Map<string, TelemetrySample[]>> {
  const history = new Map<string, TelemetrySample[]>();
  try {
    const response = await fetch("/api/clients?hours=6", { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return history;
    const payload = (await response.json()) as { history?: ClientMinuteJson[] };
    for (const row of payload.history ?? []) {
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
  } catch {
    // collector down — fall through with whatever we can poll ourselves
  }
  return history;
}

export interface RouterNetwork {
  clients: WifiClientJson[];
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null; // null = still probing
  /** Rename a device on the router (persists across reconnects). */
  renameClient: (macAddress: string, givenName: string) => Promise<void>;
  /** Rolling per-MAC throughput samples (down/up in bps) built from each poll. */
  throughputHistory: Map<string, TelemetrySample[]>;
}

export function useRouterNetwork(active: boolean): RouterNetwork {
  const [clients, setClients] = useState<WifiClientJson[]>([]);
  const [wifiConfig, setWifiConfig] = useState<WifiNetworkConfigJson | null>(null);
  const [routerReachable, setRouterReachable] = useState<boolean | null>(null);
  const [throughputHistory, setThroughputHistory] = useState<Map<string, TelemetrySample[]>>(new Map());
  const historyRef = useRef<Map<string, TelemetrySample[]>>(new Map());
  const clientRef = useRef<Promise<DishClient> | null>(null);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timerId = 0;

    (async () => {
      try {
        clientRef.current ??= DishClient.load("router");
        const routerClient = await clientRef.current;
        // Seed once from the collector before the first poll appends to it.
        if (historyRef.current.size === 0) {
          const persisted = await fetchPersistedClientHistory();
          if (disposed) return;
          if (persisted.size > 0) {
            historyRef.current = persisted;
            setThroughputHistory(new Map(persisted));
          }
        }
        const pollClients = async () => {
          try {
            const clientList = await routerClient.getWifiClients();
            if (disposed) return;
            const now = Date.now();
            const history = historyRef.current;
            for (const client of clientList) {
              if (!client.macAddress) continue;
              const downBps = throughputMbps(client.rxStats) * 1_000_000;
              const upBps = throughputMbps(client.txStats) * 1_000_000;
              const series = history.get(client.macAddress) ?? [];
              series.push({ timestampMs: now, latencyMs: null, dropRate: 0, downlinkBps: downBps, uplinkBps: upBps, powerW: 0 });
              const cutoff = now - HISTORY_WINDOW_MS;
              while (series.length > 0 && series[0].timestampMs < cutoff) series.shift();
              history.set(client.macAddress, series);
            }
            setClients(clientList);
            setThroughputHistory(new Map(history));
            setRouterReachable(true);
          } catch {
            if (!disposed) setRouterReachable(false);
          }
        };
        routerClient
          .getWifiConfig()
          .then((config) => !disposed && setWifiConfig(config))
          .catch(() => {});
        await pollClients();
        timerId = window.setInterval(pollClients, CLIENTS_POLL_MS);
      } catch {
        if (!disposed) setRouterReachable(false);
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [active]);

  const renameClient = useCallback(async (macAddress: string, givenName: string) => {
    clientRef.current ??= DishClient.load("router");
    const routerClient = await clientRef.current;
    await routerClient.setClientGivenName(macAddress, givenName);
    // reflect immediately; the next poll confirms from the router
    setClients((current) =>
      current.map((client) => (client.macAddress === macAddress ? { ...client, givenName } : client)),
    );
  }, []);

  return { clients, wifiConfig, routerReachable, renameClient, throughputHistory };
}
