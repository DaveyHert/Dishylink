// One device's data allowance, from the historian's rule store.
//
// The rule rides its own request rather than the roster: it changes when someone
// edits it, not on the router's cadence, and the card that shows it is open far
// less often than the network panel behind it.

import { useCallback, useEffect, useState } from "react";
import type { MeterCycle, MeterRule } from "@core/dataMeter";
import { apiRequest } from "../lib/apiHost";

const REFRESH_MS = 10_000;

export interface MeterRuleView extends MeterRule {
  usageBytes: number;
  deviceName: string;
}

export interface DataMeter {
  rule: MeterRuleView | null;
  /** Whether the recorder can actually pause: the write needs an account session,
   *  and a rule that cannot be enforced should say so before it is relied on. */
  enforceable: boolean;
  loading: boolean;
  error: string | null;
  save: (options: {
    allocationBytes: number;
    pauseAtBytes: number;
    autoPause: boolean;
    cycle: MeterCycle;
  }) => Promise<void>;
  restart: () => Promise<void>;
  remove: () => Promise<void>;
}

function cycleParams(cycle: MeterCycle): Record<string, string> {
  if (cycle.kind === "weekly") return { cycle: cycle.kind, weekday: String(cycle.weekday) };
  if (cycle.kind === "monthly") return { cycle: cycle.kind, day: String(cycle.day) };
  if (cycle.kind === "custom")
    return { cycle: cycle.kind, days: String(cycle.days), start: String(cycle.startMs) };
  return { cycle: cycle.kind };
}

export function useDataMeter(clientKey: string | null): DataMeter {
  const [rule, setRule] = useState<MeterRuleView | null>(null);
  const [enforceable, setEnforceable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientKey) return;
    try {
      const response = await apiRequest(
        `/api/clients/meters?client=${encodeURIComponent(clientKey)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { rules?: MeterRuleView[]; enforceable?: boolean };
      setRule(body.rules?.[0] ?? null);
      setEnforceable(body.enforceable === true);
      setError(null);
    } catch {
      setError("The recorder isn’t answering, so data limits can’t be read or changed.");
    } finally {
      setLoading(false);
    }
  }, [clientKey]);

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

  const write = useCallback(
    async (path: string, method = "POST") => {
      try {
        const response = await apiRequest(path, { method });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setError(null);
      } catch {
        setError("The recorder refused the change.");
      } finally {
        await load();
      }
    },
    [load],
  );

  const save: DataMeter["save"] = useCallback(
    async ({ allocationBytes, pauseAtBytes, autoPause, cycle }) => {
      if (!clientKey) return;
      const query = new URLSearchParams({
        client: clientKey,
        allocation: String(Math.round(allocationBytes)),
        pauseAt: String(Math.round(pauseAtBytes)),
        autoPause: autoPause ? "1" : "0",
        ...cycleParams(cycle),
      });
      await write(`/api/clients/meters?${query.toString()}`);
    },
    [clientKey, write],
  );

  const restart = useCallback(async () => {
    if (!clientKey) return;
    await write(`/api/clients/meters/reset?client=${encodeURIComponent(clientKey)}`);
  }, [clientKey, write]);

  const remove = useCallback(async () => {
    if (!clientKey) return;
    await write(`/api/clients/meters?client=${encodeURIComponent(clientKey)}`, "DELETE");
  }, [clientKey, write]);

  return { rule, enforceable, loading, error, save, restart, remove };
}
