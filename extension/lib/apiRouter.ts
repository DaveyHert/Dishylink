// Answers /api/* for the extension, reading from the IndexedDB history store —
// the counterpart to the historian's HTTP handler and the desktop app's app://
// handler. The renderer reaches this over runtime messaging (it has no origin
// serving /api), but the routing itself is a plain function over a store, so it
// is exercised in tests with the in-memory store rather than only through a live
// service worker.
//
// Energy and usage ride the same per-minute buckets, so one summary answers
// both. Feeds the extension does not record yet answer 503, which the dashboard
// renders as its "history unavailable" state — the same thing it shows when the
// desktop historian isn't running.

import { energyRangeBounds, RANGES, summarizeEnergy, type Range } from "@core/energySummary";
import { ClientTotalsCore, type ClientTotal } from "@core/clientTotals";
import type { ClientSampleRow, HistoryStore } from "./history";

// The alert keys the dish raises for heat; /api/thermal is the alert log narrowed
// to these. Matches the historian's THERMAL_ALERT_KEYS.
const THERMAL_ALERT_KEYS = ["thermalThrottle", "thermalShutdown", "powerSupplyThermalThrottle"];

export interface ApiReply {
  status: number;
  body: unknown;
}

export async function routeApiRequest(
  store: HistoryStore,
  path: string,
  now: Date = new Date(),
  method: string = "GET",
  body?: string,
): Promise<ApiReply> {
  const url = new URL(path, "http://extension.invalid");

  if (url.pathname === "/api/energy" || url.pathname === "/api/usage") {
    const requested = url.searchParams.get("range") as Range | null;
    const range: Range = requested && RANGES.includes(requested) ? requested : "today";
    const { startSec, endSec } = energyRangeBounds(range, now);
    const buckets = await store.readMinutes(startSec, endSec);
    return { status: 200, body: summarizeEnergy(buckets, range, now) };
  }

  if (url.pathname === "/api/outages") {
    return { status: 200, body: { events: await store.readOutages(now.getTime()) } };
  }

  if (url.pathname === "/api/radio") {
    return { status: 200, body: await store.readRadio() };
  }

  // The dish's raw 1 Hz window, so the main charts backfill on reload.
  if (url.pathname === "/api/samples") {
    const minutes = Math.min(360, Math.max(1, Number(url.searchParams.get("minutes") ?? 360)));
    return { status: 200, body: { samples: await store.readSamples(minutes, now.getTime()) } };
  }

  if (url.pathname === "/api/alerts") {
    return { status: 200, body: { episodes: await store.readAlerts(now.getTime()) } };
  }

  if (url.pathname === "/api/thermal") {
    // Thermal is the alert log filtered to the thermal keys, in the source-less
    // shape the historian's thermal store serves.
    const episodes = (await store.readAlerts(now.getTime()))
      .filter((e) => THERMAL_ALERT_KEYS.includes(e.key))
      .map((e) => ({ alertKey: e.key, startMs: e.startMs, endMs: e.endMs }));
    return { status: 200, body: { episodes } };
  }

  if (url.pathname === "/api/obstruction/snapshots") {
    return { status: 200, body: { snapshots: await store.readObstructionSnapshots(now.getTime()) } };
  }

  // Zero one device's total but keep it listed — a reset, distinct from delete.
  if (url.pathname === "/api/clients/totals/reset" && method === "POST") {
    const key = url.searchParams.get("client");
    const odometer = await loadOdometer(store);
    const reset = key ? odometer.reset(key, now.getTime()) : false;
    if (reset) await store.writeTotalsSnapshot(odometer.toSnapshot());
    return { status: 200, body: { reset } };
  }

  // The monthly usage odometer: read the list, or delete one device's record
  // (?client=) or all of them (no id). Deleting removes the entry; /reset zeroes
  // a device while keeping it listed.
  if (url.pathname === "/api/clients/totals") {
    if (method === "DELETE") {
      const key = url.searchParams.get("client");
      const odometer = await loadOdometer(store);
      const result = key ? { removed: odometer.remove(key) } : (odometer.clear(), { cleared: true });
      await store.writeTotalsSnapshot(odometer.toSnapshot());
      return { status: 200, body: result };
    }
    return { status: 200, body: { totals: await readTotals(store) } };
  }

  // The open dashboard persists its own 1 Hz client samples (the drain is far too
  // coarse), so the 15-minute detail chart opens filled rather than live-building.
  if (url.pathname === "/api/clients/samples" && method === "POST") {
    const samples = parseSamples(body);
    await store.putClientSamples(samples, now.getTime());
    return { status: 200, body: { stored: samples.length } };
  }

  // Per-device history in the two tiers the live hook seeds from: `history` is the
  // per-minute rows (6h chart), `samples` the raw 1 Hz window (15-minute chart)
  // the open dashboard writes. `since` callers are tailing the live window and
  // already hold the minute rows, so those get only samples; `totals` ride the
  // slower beat, sent when asked or on a fresh (no-`since`) read.
  if (url.pathname === "/api/clients") {
    const hours = Math.min(6, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    const key = url.searchParams.get("client") ?? undefined;
    const wantSamples = url.searchParams.get("samples") === "1";
    const sinceMs = Number(url.searchParams.get("since") ?? 0) || undefined;
    return {
      status: 200,
      body: {
        history: sinceMs ? [] : await store.readClientMinutes(hours, key, now.getTime()),
        ...(wantSamples
          ? { samples: await store.readClientSamples(sinceMs ?? 0, key, now.getTime()) }
          : {}),
        ...(url.searchParams.get("totals") === "1" || !sinceMs
          ? { totals: await readTotals(store, key) }
          : {}),
      },
    };
  }

  return { status: 503, body: { error: `no extension history for ${url.pathname}` } };
}

/** Rehydrate the odometer from its stored snapshot. The gap window only governs
 *  recording, never a read or a reset/delete, so the default is fine here. */
async function loadOdometer(store: HistoryStore): Promise<ClientTotalsCore> {
  const odometer = new ClientTotalsCore();
  const snapshot = await store.readTotalsSnapshot();
  if (snapshot) odometer.loadSnapshot(snapshot);
  return odometer;
}

/** Totals for one device by key, or all. */
async function readTotals(store: HistoryStore, key?: string): Promise<ClientTotal[]> {
  return (await loadOdometer(store)).totals(key);
}

/** Parse a posted sample batch, tolerating a malformed body as an empty write. */
function parseSamples(body?: string): ClientSampleRow[] {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) ? (parsed as ClientSampleRow[]) : [];
  } catch {
    return [];
  }
}
