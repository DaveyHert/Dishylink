// The time-lapse's one source of obstruction history: the historian's store.
//
// These used to be written by whichever tab happened to be open, into that
// browser's localStorage. The historian records them on its own clock instead,
// so the history is the same in every browser, does not gap while the app is
// closed, and keeps a week rather than the ~2 days a quota-capped localStorage
// could hold. Both the dashboard's dome and the full-page sky view read here.

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
