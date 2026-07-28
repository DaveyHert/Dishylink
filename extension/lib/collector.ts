// One drain tick: poll the dish's history, add the samples past the cursor to
// IndexedDB, advance the cursor. Called from the alarm and once on startup.
//
// The extension collects only while the browser runs, so a tick is best-effort:
// the dish's ~15-minute ring buffer backfills short gaps on the next successful
// drain, and longer gaps show as reduced coverage. A failed tick is recorded,
// not thrown — collection resumes on the next alarm.

import { DishClient } from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";
import { decodeHistoryWindow, decodeOutageEvents, decodeRadioReadings } from "@core/telemetry";
import { applyDrain, IndexedDbHistory, type HistoryStore } from "./history";
import { packObstructionCells } from "./obstruction";
import { DISH_HANDLE_URL, ROUTER_HANDLE_URL } from "./endpoints";

const DRAIN_TIMEOUT_MS = 8_000;
const OBSTRUCTION_INTERVAL_MS = 3_600_000; // one snapshot an hour, as the historian records

export type DrainStatus =
  | { ok: true; at: number }
  | { ok: false; at: number; message: string };

export async function drainOnce(): Promise<DrainStatus> {
  const at = Date.now();
  try {
    const [store, client] = await Promise.all([
      IndexedDbHistory.open(),
      DishClient.load("dish", { handleUrl: DISH_HANDLE_URL }),
    ]);
    const history = await client.getHistory(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
    const now = Date.now();
    await applyDrain(store, decodeHistoryWindow(history, now));
    // Outages ride the same reply — the dish's event log / outage list is in the
    // history window we already fetched, so recording them costs no extra poll.
    await store.putOutages(decodeOutageEvents(history));
    // Status-derived and router feeds are best-effort: a get_status miss or an
    // unreachable (or non-Starlink) router must not mark the dish drain failed.
    await drainDishStatus(store, client).catch(() => {});
    await drainObstruction(store, client).catch(() => {});
    await drainRouterFeeds(store).catch(() => {});
    return { ok: true, at };
  } catch (error) {
    return { ok: false, at, message: describeDrainError(error) };
  }
}

/** Record the dish's live alert booleans as open/closed episodes. get_status is
 *  the safe, tiny reply the historian already polls. */
async function drainDishStatus(store: HistoryStore, dish: DishClient): Promise<void> {
  const status = await dish.getStatus(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
  await store.putAlerts("dish", status.alerts ?? {}, Date.now());
}

/** Record an hourly obstruction-map snapshot for the time-lapse. Checked every
 *  tick but only fetched when an hour has passed, so it costs a poll once an hour. */
async function drainObstruction(store: HistoryStore, dish: DishClient): Promise<void> {
  const snapshots = await store.readObstructionSnapshots();
  const newest = snapshots[snapshots.length - 1];
  if (newest && Date.now() - newest.takenAtMs < OBSTRUCTION_INTERVAL_MS) return;
  const map = await dish.getObstructionMap(AbortSignal.timeout(DRAIN_TIMEOUT_MS));
  if (!map.snr?.length || !map.numRows || map.numRows !== map.numCols) return;
  await store.putObstruction({
    takenAtMs: Date.now(),
    gridSize: map.numRows,
    packedCells: packObstructionCells(map.snr),
    maxThetaDeg: map.maxThetaDeg,
  });
}

/** Poll the router's own feeds — radio temperatures and its alert set. Separate
 *  from the dish drain and best-effort: get_radio_stats and get_status are the
 *  safe RPCs the historian already polls (never get_ping). */
async function drainRouterFeeds(store: HistoryStore): Promise<void> {
  const router = await DishClient.load("router", { handleUrl: ROUTER_HANDLE_URL });
  const [stats, status] = await Promise.all([
    router.getRadioStats(AbortSignal.timeout(DRAIN_TIMEOUT_MS)),
    router.getRouterStatus(AbortSignal.timeout(DRAIN_TIMEOUT_MS)),
  ]);
  const now = Date.now();
  await store.putRadio(decodeRadioReadings(stats), now);
  await store.putAlerts("router", status.alerts ?? {}, now);
}

function describeDrainError(error: unknown): string {
  if (error instanceof GrpcWebError) return `dish returned grpc status ${error.grpcStatus}`;
  const message = error instanceof Error ? error.message : String(error);
  // A fetch to 192.168.100.1 that never connects surfaces as a TypeError with no
  // grpc status. Below Chrome 144 that is the Local Network Access bug silently
  // blocking the service worker; at or above it the dish is simply unreachable.
  if (/fetch|network|load failed|aborted/i.test(message))
    return "couldn't reach the dish at 192.168.100.1 — on Chrome below 144, Local Network Access blocks the background fetch; otherwise the dish is offline or on another network";
  return message;
}
