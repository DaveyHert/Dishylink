// The time-lapse's one source of obstruction history: the historian's store.
//
// The historian records snapshots on its own clock and serves them from disk,
// which is what makes the history trustworthy: identical in every browser, no gap
// for the hours the app was closed, and a week deep rather than the ~2 days a
// per-browser quota would allow. Both the dashboard's dome and the full-page sky
// view read from here, so they can never show different histories.

import { useEffect, useState } from "react";
import { fetchSnapshots, type ObstructionSnapshot } from "../lib/obstructionSnapshots";

/** The historian records hourly; re-read often enough that a tab left open
 *  picks up new snapshots without a reload, but no faster than is useful. */
const REFRESH_MS = 600_000;

export function useObstructionSnapshots(): ObstructionSnapshot[] {
  const [snapshots, setSnapshots] = useState<ObstructionSnapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void fetchSnapshots().then((fromHistorian) => {
        // null means the historian is unreachable. Keep whatever is already
        // held rather than blanking a scrubber the user may be dragging.
        if (!cancelled && fromHistorian) setSnapshots(fromHistorian);
      });
    };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return snapshots;
}
