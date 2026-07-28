// One drain tick: poll the dish's history, add the samples past the cursor to
// IndexedDB, advance the cursor. Called from the alarm and once on startup.
//
// The extension collects only while the browser runs, so a tick is best-effort:
// the dish's ~15-minute ring buffer backfills short gaps on the next successful
// drain, and longer gaps show as reduced coverage. A failed tick is recorded,
// not thrown — collection resumes on the next alarm.

import { DishClient } from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";
import { decodeHistoryWindow, decodeOutageEvents } from "@core/telemetry";
import { applyDrain, IndexedDbHistory } from "./history";
import { DISH_HANDLE_URL } from "./endpoints";

const DRAIN_TIMEOUT_MS = 8_000;

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
    return { ok: true, at };
  } catch (error) {
    return { ok: false, at, message: describeDrainError(error) };
  }
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
