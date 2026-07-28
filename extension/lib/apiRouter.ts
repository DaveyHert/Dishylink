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
import type { HistoryStore } from "./history";

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
    return { status: 200, body: { events: await store.readOutages() } };
  }

  if (url.pathname === "/api/radio") {
    const hours = Math.min(24, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    return { status: 200, body: await store.readRadio(hours, now.getTime()) };
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

  return { status: 503, body: { error: `no extension history for ${url.pathname}` } };
}
