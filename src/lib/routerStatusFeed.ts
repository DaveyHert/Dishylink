// The app's ONE router get_status poll, fanned out to every consumer.
//
// Two surfaces want this reply — the alerts panel reads `.alerts`, the latency
// chart reads `.popPingLatencyMs` — and when each ran its own poll the router
// answered the same question twice on two clocks. The router is a small
// embedded box whose request budget is not free: on 2026-07-20, polling it
// harder than necessary tripped its firmware watchdog (SOFTWARE_WATCHDOG) into
// a reboot loop that took the whole network down with it. However many
// consumers mount, the router hears from this module exactly once per 5s —
// anything new that wants a router status reading subscribes here rather than
// adding a poll.

import { DishClient, type WifiStatusJson } from "@core/dishClient";

export interface RouterStatusSnapshot {
  /** The last reply. Kept through failures so alert state can caveat as stale
   *  rather than snapping to "all clear" the moment the router stops answering. */
  status: WifiStatusJson | null;
  /** null while first probing; false while polls are failing (unreachable, or
   *  a non-Starlink router / bypass mode where nothing answers get_status). */
  reachable: boolean | null;
}

const POLL_MS = 5_000;

type Listener = (snapshot: RouterStatusSnapshot) => void;

const listeners = new Set<Listener>();
let snapshot: RouterStatusSnapshot = { status: null, reachable: null };
let timerId: number | null = null;
let clientPromise: Promise<DishClient> | null = null;
// A poll must never outlive its interval or overlap itself. Without a deadline,
// an unanswering router leaves every request hanging; at one per 5s they pile
// up until they exhaust the browser's ~6-connections-per-origin budget, and
// then the DISH poll can't get a socket either and the app reports a dish
// outage that isn't happening.
let inFlight = false;

async function poll(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    clientPromise ??= DishClient.load("router");
    const client = await clientPromise;
    const status = await client.getRouterStatus(AbortSignal.timeout(4_000));
    snapshot = { status, reachable: true };
  } catch {
    snapshot = { status: snapshot.status, reachable: false };
  } finally {
    inFlight = false;
  }
  for (const listener of listeners) listener(snapshot);
}

/**
 * Starts the poll with the first subscriber and stops it with the last, so a
 * closed app stops asking. New subscribers get the current snapshot at once
 * rather than waiting out the interval.
 */
export function subscribeRouterStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  if (timerId === null) {
    void poll();
    timerId = window.setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };
}
