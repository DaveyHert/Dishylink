// Read-only account + usage from the user's own starlink.com session, via the
// host's /cloud/* binding. On-demand (fetched when a cloud surface opens), not a
// poll loop — this data changes slowly and must not depend on the historian.
//
// One session means one answer, so each endpoint is a single shared store rather
// than per-component state: every consumer reads the same snapshot, the first one
// to want it pays for the fetch, and a session change invalidates it for all of
// them at once. Per-component state gave one endpoint two independent lives —
// two fetches when two surfaces were open, and a satellite view still holding
// "not connected" after the account panel had signed in.

import { useEffect, useSyncExternalStore } from "react";
import { subscribeCloudSession } from "../lib/cloudHost";
import {
  fetchCloudAccount,
  fetchCloudUsage,
  CloudNotConnectedError,
  type CloudAccount,
  type CloudUsage,
} from "../lib/starlinkCloud";

type Status = "loading" | "ready" | "not-connected" | "error";

interface CloudStoreState<T> {
  data: T | null;
  status: Status;
}

interface CloudStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CloudStoreState<T>;
  /** Fetch unless this store is already loaded or in flight. */
  ensure: () => void;
  reload: () => void;
  /** Drop what we know; refetch if anyone is still watching. */
  invalidate: () => void;
}

function createCloudStore<T>(fetcher: () => Promise<T>): CloudStore<T> {
  const listeners = new Set<() => void>();
  // Held as one object so getSnapshot stays referentially stable between changes,
  // which is what useSyncExternalStore requires to avoid re-rendering forever.
  let snapshot: CloudStoreState<T> = { data: null, status: "loading" };
  let loaded = false;
  let inFlight = false;
  // Only the newest request may write; an invalidate mid-flight abandons the
  // older one rather than letting it land on top of fresher state. The request
  // itself is not aborted — it is shared, so one consumer unmounting must not
  // cancel it for the others.
  let token = 0;

  function set(next: CloudStoreState<T>) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function load() {
    const mine = ++token;
    inFlight = true;
    // A refresh over data we already have keeps showing it rather than blanking
    // the surface back to a spinner.
    if (snapshot.status !== "ready") set({ data: snapshot.data, status: "loading" });
    fetcher()
      .then((data) => {
        if (mine !== token) return;
        loaded = true;
        inFlight = false;
        set({ data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (mine !== token) return;
        loaded = true;
        inFlight = false;
        set({
          data: null,
          status: error instanceof CloudNotConnectedError ? "not-connected" : "error",
        });
      });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    ensure() {
      if (loaded || inFlight) return;
      load();
    },
    reload() {
      loaded = false;
      load();
    },
    invalidate() {
      loaded = false;
      token++; // abandon anything in flight against the old session
      inFlight = false;
      if (listeners.size) load();
      else set({ data: null, status: "loading" });
    },
  };
}

const cloudAccountStore = createCloudStore(() => fetchCloudAccount());
const cloudUsageStore = createCloudStore(() => fetchCloudUsage());

// Connecting, disconnecting, or signing in through the host makes every cached
// answer wrong at once — including a cached "not connected".
subscribeCloudSession(() => {
  cloudAccountStore.invalidate();
  cloudUsageStore.invalidate();
});

function useCloudStore<T>(
  store: CloudStore<T>,
  active: boolean,
): CloudStoreState<T> & { reload: () => void } {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (active) store.ensure();
  }, [store, active]);
  return { data: snapshot.data, status: snapshot.status, reload: store.reload };
}

export function useCloudAccount(
  active: boolean,
): CloudStoreState<CloudAccount> & { reload: () => void } {
  return useCloudStore(cloudAccountStore, active);
}

export function useCloudUsage(
  active: boolean,
): CloudStoreState<CloudUsage> & { reload: () => void } {
  return useCloudStore(cloudUsageStore, active);
}
