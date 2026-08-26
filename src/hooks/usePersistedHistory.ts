// Shared fetch/poll loop behind useEnergyHistory and useLatencyHistory: both
// pull a summary from the local historian service, survive reloads, and refresh
// on the same cadence. One store per request path, so a tile and a panel asking
// for the same range share a single 30s poll instead of racing two.

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";

export interface PersistedHistoryState<T> {
  data: T | null;
  loading: boolean;
  /** True when the historian service isn't reachable. */
  unavailable: boolean;
}

const REFRESH_MS = 30_000;

interface PathStore {
  state: PersistedHistoryState<unknown>;
  listeners: Set<() => void>;
  timer: number;
}

const stores = new Map<string, PathStore>();

function getStore(path: string): PathStore {
  let store = stores.get(path);
  if (!store) {
    store = {
      state: { data: null, loading: false, unavailable: false },
      listeners: new Set(),
      timer: 0,
    };
    stores.set(path, store);
  }
  return store;
}

function set(store: PathStore, patch: Partial<PersistedHistoryState<unknown>>): void {
  store.state = { ...store.state, ...patch };
  for (const notify of store.listeners) notify();
}

async function load(path: string, store: PathStore): Promise<void> {
  set(store, { loading: true });
  try {
    const response = await apiRequest(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    set(store, { data, unavailable: false, loading: false });
  } catch {
    set(store, { unavailable: true, loading: false });
  }
}

export function usePersistedHistory<T>(path: string, active: boolean): PersistedHistoryState<T> {
  const [state, setState] = useState<PersistedHistoryState<T>>({
    data: null,
    loading: false,
    unavailable: false,
  });

  useEffect(() => {
    if (!active) return;
    const store = getStore(path);
    const listener = () =>
      setState((prev) => {
        const next = store.state as PersistedHistoryState<T>;
        // Keep the last data on screen while a freshly selected path loads, so a
        // range switch swaps bars in place instead of blanking the chart. The
        // per-component hooks behaved this way before they shared a store: data
        // only ever advanced, it was never reset to null between ranges.
        return next.data === null && prev.data !== null ? { ...next, data: prev.data } : next;
      });
    listener(); // adopt whatever this path already holds, instantly
    store.listeners.add(listener);
    // One poll loop per path, shared by every subscriber. timer === 0 means none
    // is running yet; the kickoff waits a microtask so no listener is notified
    // mid-subscribe, and the re-check keeps a subscribe/unsubscribe churn from
    // starting a second interval.
    if (store.timer === 0) {
      queueMicrotask(() => {
        if (store.listeners.size === 0 || store.timer !== 0) return;
        void load(path, store);
        store.timer = window.setInterval(() => void load(path, store), REFRESH_MS);
      });
    }
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0) {
        window.clearInterval(store.timer);
        store.timer = 0;
      }
    };
  }, [path, active]);

  return state;
}
