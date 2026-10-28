// One recorder feed, read on a slow beat. Empty while the recorder is down: the
// dish's own data still fills every surface these feed, so a missing recorder
// is an absence, not an error.

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";

const REFRESH_MS = 30_000;

/** `pick` must be a stable function (declare it at module level): it is part
 *  of the effect's dependencies, and a fresh one each render would restart the
 *  poll every time. */
export function usePolledEndpoint<T>(path: string, pick: (body: unknown) => T, initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const response = await apiRequest(path, { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!disposed) setValue(pick(body));
      } catch {
        // recorder down
      }
    };
    void load();
    const timerId = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [path, pick]);

  return value;
}
