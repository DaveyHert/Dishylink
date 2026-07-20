// Per-device monthly usage from the collector's odometer (/api/clients/totals),
// with the delete/clear actions the usage list exposes. Kept separate from the
// live network hook: this drives the Data Usage sheet, which is open on its own
// and wants the whole list (including devices currently offline), not just the
// clients the router reports right now.

import { useCallback, useEffect, useState } from "react";
import type { ClientUsageTotal } from "../lib/clientUsage";

const REFRESH_MS = 10_000;

export function useClientTotals(active: boolean) {
  const [totals, setTotals] = useState<ClientUsageTotal[] | null>(null);
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
          ? "The collector refused the change — open the dashboard from this machine or your local network."
          : `The collector rejected the change (HTTP ${response.status}).`,
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clients/totals");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { totals?: ClientUsageTotal[] };
      setTotals(payload.totals ?? []);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
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
  }, [active, load]);

  // Optimistic: drop the row immediately, then confirm against the collector.
  const remove = useCallback(
    async (macAddress: string) => {
      setTotals(
        (current) => current?.filter((total) => total.macAddress !== macAddress) ?? current,
      );
      try {
        checkWrite(
          await fetch(`/api/clients/totals?mac=${encodeURIComponent(macAddress)}`, {
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
    async (macAddress: string) => {
      setTotals(
        (current) =>
          current?.map((total) =>
            total.macAddress === macAddress
              ? { ...total, rxBytes: 0, txBytes: 0, sinceMs: Date.now() }
              : total,
          ) ?? current,
      );
      try {
        checkWrite(
          await fetch(`/api/clients/totals/reset?mac=${encodeURIComponent(macAddress)}`, {
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
      checkWrite(await fetch("/api/clients/totals", { method: "DELETE" }));
    } finally {
      await load();
    }
  }, [load, checkWrite]);

  return { totals, unavailable, writeError, reset, remove, clearAll };
}
