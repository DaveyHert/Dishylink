// Read-only account + usage from the user's own starlink.com session, via the
// host's /cloud/* binding. On-demand (fetched when a cloud surface opens), not a
// poll loop — this data changes slowly and must not depend on the historian.

import { useCallback, useEffect, useState } from "react";
import {
  fetchCloudAccount,
  fetchCloudUsage,
  CloudNotConnectedError,
  type CloudAccount,
  type CloudUsage,
} from "../lib/starlinkCloud";

type Status = "loading" | "ready" | "not-connected" | "error";

interface CloudResource<T> {
  data: T | null;
  status: Status;
  /** Re-fetch — e.g. after the user connects a session from the UI. */
  reload: () => void;
}

function useCloudResource<T>(fetcher: (signal?: AbortSignal) => Promise<T>, active: boolean): CloudResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setStatus((prev) => (prev === "ready" ? prev : "loading"));
    fetcher(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus(error instanceof CloudNotConnectedError ? "not-connected" : "error");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nonce]);

  return { data, status, reload };
}

export function useCloudAccount(active: boolean): CloudResource<CloudAccount> {
  return useCloudResource(fetchCloudAccount, active);
}

export function useCloudUsage(active: boolean): CloudResource<CloudUsage> {
  return useCloudResource(fetchCloudUsage, active);
}
