// The extension's stand-in for the always-on historian's fast client poll.
//
// Per-device 1 Hz throughput is the one series no once-a-minute recorder can
// produce: the router keeps no per-client history and hands over only a live
// counter, so a real rate has to be measured by polling faster than the router
// refreshes (~1 Hz) and detecting each counter edge. On desktop the historian
// does that continuously; here there is no such process, so the open dashboard
// does it while it is on screen — the same job, the same ThroughputTracker, just
// bound to the page's lifetime instead of a daemon's.
//
// It writes through /api/clients/samples into the same store the drain and the
// desktop historian fill, so the app reads its series back from /api/clients
// exactly as on every other host. Nothing about this leaks into the shared app:
// the dashboard entry point starts it, the app stays oblivious.
//
// Deliberately not the odometer: usage totals are the drain's job (one writer,
// no double count). This produces only the live rate samples.

import { DishClient, type WifiClientJson, type WifiClientStatsJson } from "@core/dishClient";
import { ThroughputTracker } from "@core/throughputTracker";
import { usageKey } from "@core/clientUsage";
import { apiRequest } from "@/lib/apiHost";
import type { ClientSampleRow } from "./history";
import { routerHandleUrl } from "./endpoints";

// Faster than the router's ~1005 ms counter refresh, so every edge is caught as
// it lands — the rate the tracker needs. Only runs while the dashboard is on
// screen, so it is lighter than the historian's identical poll that never stops.
const POLL_MS = 200;
const POLL_TIMEOUT_MS = 4_000;
// Record at 1 Hz, not every poll. The tracker holds an exact rate between counter
// edges, so writing on every 200 ms poll would quintuple the store and the page↔
// worker messaging for no extra resolution — the historian records at 1 Hz for the
// same reason (CLIENTS_RECORD_MS).
const RECORD_MS = 1_000;

/** The 15s average, read finitely — the fallback rate when a delta is not yet
 *  measurable (a first sighting, a gap). 15s not 1m, matching the historian: the
 *  shorter window is closer to the truth, and txStats carries no 1m field. */
function fallbackMbps(stats: WifiClientStatsJson | undefined): number {
  const value = Number(stats?.throughputMbpsLast15sAvg);
  return Number.isFinite(value) ? value : 0;
}

/** One poll's worth of live samples, one per roster entry. Mirrors the
 *  historian's rate path: the tracker is keyed by MAC + entry id so a same-vendor
 *  group stays separate, but each sample is stored under the key the odometer and
 *  the app both join on (the clientId). */
export function buildSamples(
  clients: WifiClientJson[],
  tracker: ThroughputTracker,
  nowMs: number,
): ClientSampleRow[] {
  const live = clients.filter(
    (c): c is WifiClientJson & { macAddress: string } =>
      !!c.macAddress && (!c.role || c.role === "CLIENT"),
  );
  const entryKeys: string[] = [];
  const samples: ClientSampleRow[] = [];
  for (const client of live) {
    const entryId =
      client.clientId !== undefined
        ? String(client.clientId)
        : (client.ipAddress ?? client.macAddress);
    const entryKey = `${client.macAddress}|${entryId}`;
    entryKeys.push(entryKey);
    // Absent stats mean "no reading", not zero bytes — passing 0 would read as a
    // counter reset and blink the device to idle mid-transfer.
    const rx = client.rxStats?.bytes;
    const tx = client.txStats?.bytes;
    const counters =
      rx === undefined || tx === undefined
        ? undefined
        : { rxBytes: Number(rx), txBytes: Number(tx) };
    const rates = tracker.rates(entryKey, counters, nowMs, {
      downMbps: fallbackMbps(client.rxStats),
      upMbps: fallbackMbps(client.txStats),
    });
    samples.push({
      key: usageKey(client.clientId, client.macAddress),
      macAddress: client.macAddress,
      atMs: nowMs,
      downMbps: rates.downMbps,
      upMbps: rates.upMbps,
    });
  }
  tracker.retain(entryKeys);
  return samples;
}

/**
 * Start sampling client throughput while the dashboard is open, and return a
 * stop function. Runs only while the page is visible — a hidden tab needs no live
 * series and should not poll the router. Polling runs at 5 Hz to catch each
 * counter edge and never overlaps itself; recording is a separate 1 Hz beat.
 */
export function startClientSampler(): () => void {
  const tracker = new ThroughputTracker();
  const router = DishClient.load("router", { handleUrl: routerHandleUrl() });
  let inFlight = false;
  let latest: ClientSampleRow[] = [];

  // Poll fast so the tracker catches every counter edge as it lands; the samples
  // it returns already carry an exact rate, held steady between edges.
  const poll = async () => {
    if (inFlight || document.visibilityState !== "visible") return;
    inFlight = true;
    try {
      const clients = await (await router).getWifiClients(AbortSignal.timeout(POLL_TIMEOUT_MS));
      latest = buildSamples(clients, tracker, Date.now());
    } catch {
      // Router briefly unreachable, or the page went away mid-poll: the next
      // tick retries, and an edge missed across the gap is re-based, not invented.
    } finally {
      inFlight = false;
    }
  };

  // Persist the newest poll once a second. Clearing after a send means a stalled
  // poll records nothing, rather than re-storing a stale rate under a new second.
  const record = async () => {
    if (latest.length === 0 || document.visibilityState !== "visible") return;
    const batch = latest;
    latest = [];
    try {
      await apiRequest("/api/clients/samples", { method: "POST", body: JSON.stringify(batch) });
    } catch {
      // A dropped POST is not re-queued; the next second sends a fresh sample.
    }
  };

  const pollId = window.setInterval(() => void poll(), POLL_MS);
  const recordId = window.setInterval(() => void record(), RECORD_MS);
  void poll();
  return () => {
    window.clearInterval(pollId);
    window.clearInterval(recordId);
  };
}
