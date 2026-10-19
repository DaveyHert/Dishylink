// The extension's half of the outage post-mortem: the same report the desktop
// recorder writes, built from the IndexedDB history the drain keeps.

import type { AlertTransition } from "@core/alertEngine";
import { BEFORE_WINDOW_MS, buildOutageReport, isOutageSourceKey } from "@core/postmortem";
import type { AlertEpisode, HistoryStore } from "./history";

// The sample store's whole window, so a report reaches back as far as it can.
const SAMPLE_WINDOW_MINUTES = 360;

/**
 * Write a report for each link outage among `transitions` that just ended.
 * `open` is the episode set read before the transitions were applied: the
 * store drops a closed episode that has aged past its window on the same write,
 * so a long outage can only be dated from the copy read beforehand.
 */
export async function recordOutageReports(
  store: HistoryStore,
  open: readonly AlertEpisode[],
  transitions: readonly AlertTransition[],
  nowMs: number,
): Promise<number> {
  let written = 0;
  for (const transition of transitions) {
    if (transition.kind !== "cleared" || transition.source !== "system") continue;
    if (!isOutageSourceKey(transition.key)) continue;
    const episode = open.find(
      (candidate) =>
        candidate.source === "system" &&
        candidate.key === transition.key &&
        candidate.endMs === null,
    );
    if (!episode) continue;
    const beforeStartSec = Math.floor((episode.startMs - BEFORE_WINDOW_MS) / 60_000) * 60;
    const beforeEndSec = Math.floor(episode.startMs / 60_000) * 60;
    const [dishEvents, samples, minuteBuckets, alerts] = await Promise.all([
      store.readOutages(nowMs),
      store.readSamples(SAMPLE_WINDOW_MINUTES, nowMs),
      store.readMinutes(beforeStartSec, beforeEndSec),
      store.readAlerts(nowMs),
    ]);
    await store.putReport(
      buildOutageReport({
        source: transition.key,
        startMs: episode.startMs,
        endMs: transition.atMs,
        generatedAtMs: nowMs,
        dishEvents,
        samples,
        minuteBuckets,
        dishAlerts: alerts
          .filter((candidate) => candidate.source === "dish")
          .map((candidate) => ({
            alertKey: candidate.key,
            startMs: candidate.startMs,
            endMs: candidate.endMs,
          })),
      }),
      nowMs,
    );
    written += 1;
  }
  return written;
}
