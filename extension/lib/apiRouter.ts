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

  return { status: 503, body: { error: `no extension history for ${url.pathname}` } };
}
