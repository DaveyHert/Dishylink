// Per-device monthly usage from the historian's odometer (/api/clients/totals),
// with the delete/clear actions the usage list exposes. Kept separate from the
// live network hook: this drives the Data Usage panel, which is open on its own
// and wants the whole list (including devices currently offline), not just the
// clients the router reports right now.

import { useCallback, useEffect, useState } from "react";
import { usageKey, type ClientUsageTotal } from "@core/clientUsage";
import type { MergeCandidate } from "@core/clientTotals";
import { apiRequest } from "../lib/apiHost";

const REFRESH_MS = 10_000;

export function useClientTotals() {
  const [totals, setTotals] = useState<ClientUsageTotal[] | null>(null);
  /** Buckets the recorder believes are one device under two router identities.
   *  Rides the totals reply, so a candidate can never name a row that is not in
   *  the list beside it. */
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  // A rejected write is not an exception — `fetch` resolves on 4xx — and the
  // reload in `finally` puts the row straight back. Without this the buttons
  // would look like they did nothing at all.
  const [writeError, setWriteError] = useState<string | null>(null);

  const checkWrite = useCallback((response: Response) => {
    setWriteError(
      response.ok
        ? null
        : response.status === 403
          ? "The historian refused the change — open the dashboard from this machine or your local network."
          : `The historian rejected the change (HTTP ${response.status}).`,
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/api/clients/totals");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        totals?: ClientUsageTotal[];
        mergeCandidates?: MergeCandidate[];
      };
      setTotals(payload.totals ?? []);
      setMergeCandidates(payload.mergeCandidates ?? []);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await load();
    };
    void tick();
    const timerId = window.setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [load]);

  // Optimistic: drop the row immediately, then confirm against the historian.
  // Keyed by clientId (usageKey), so removing one same-vendor device does not take
  // its siblings — they share a MAC but not a key.
  const remove = useCallback(
    async (key: string) => {
      setTotals(
        (current) =>
          current?.filter((total) => usageKey(total.clientId, total.macAddress) !== key) ?? current,
      );
      try {
        checkWrite(
          await apiRequest(`/api/clients/totals?client=${encodeURIComponent(key)}`, {
            method: "DELETE",
          }),
        );
      } finally {
        await load();
      }
    },
    [load, checkWrite],
  );

  // Zero a device's total but keep it listed. Optimistic, then confirm.
  const reset = useCallback(
    async (key: string) => {
      setTotals(
        (current) =>
          current?.map((total) =>
            usageKey(total.clientId, total.macAddress) === key
              ? { ...total, rxBytes: 0, txBytes: 0, sinceMs: Date.now() }
              : total,
          ) ?? current,
      );
      try {
        checkWrite(
          await apiRequest(`/api/clients/totals/reset?client=${encodeURIComponent(key)}`, {
            method: "POST",
          }),
        );
      } finally {
        await load();
      }
    },
    [load, checkWrite],
  );

  const clearAll = useCallback(async () => {
    setTotals([]);
    try {
      checkWrite(await apiRequest("/api/clients/totals", { method: "DELETE" }));
    } finally {
      await load();
    }
  }, [load, checkWrite]);

  /**
   * Answer a merge candidate. `same` folds the older bucket into the newer one;
   * otherwise the pair is recorded as two devices and stops being offered.
   *
   * The candidate is dropped from the local list first so the prompt closes on
   * the click. Only the prompt is optimistic — the totals themselves are left for
   * the reload, since the summed figure is the recorder's to compute (a month
   * boundary means the bytes do not add) and guessing it here could show a total
   * that never existed.
   */
  const answerMerge = useCallback(
    async (candidate: MergeCandidate, same: boolean) => {
      setMergeCandidates((current) =>
        current.filter(
          (other) => other.fromKey !== candidate.fromKey || other.toKey !== candidate.toKey,
        ),
      );
      const query = new URLSearchParams({ from: candidate.fromKey, to: candidate.toKey });
      if (!same) query.set("distinct", "1");
      try {
        checkWrite(
          await apiRequest(`/api/clients/totals/merge?${query.toString()}`, { method: "POST" }),
        );
      } finally {
        await load();
      }
    },
    [load, checkWrite],
  );

  return { totals, mergeCandidates, unavailable, writeError, reset, remove, clearAll, answerMerge };
}
