// One device's data allowance, from the historian's rule store.
//
// The rule rides its own request rather than the roster: it changes when someone
// edits it, not on the router's cadence, and the card that shows it is open far
// less often than the network panel behind it.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
  pauseEnforceable: boolean;
  loading: boolean;
  error: string | null;
  save: (options: {
    allocationBytes: number;
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
  const [pauseEnforceable, setPauseEnforceable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientKey) return;
    try {
      const response = await apiRequest(
        `/api/clients/meters?client=${encodeURIComponent(clientKey)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        rules?: MeterRuleView[];
        pauseEnforceable?: boolean;
      };
      setRule(body.rules?.[0] ?? null);
      setPauseEnforceable(body.pauseEnforceable === true);
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
    async ({ allocationBytes, autoPause, cycle }) => {
      if (!clientKey) return;
      const query = new URLSearchParams({
        client: clientKey,
        allocation: String(Math.round(allocationBytes)),
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

  return { rule, pauseEnforceable, loading, error, save, restart, remove };
}

let meteredKeys = new Set<string>();
const meteredListeners = new Set<() => void>();
let meteredTimerId: number | null = null;

async function loadMeteredKeys(): Promise<void> {
  try {
    const response = await apiRequest("/api/clients/meters");
    if (!response.ok) return;
    const body = (await response.json()) as { rules?: { clientKey: string }[] };
    const next = new Set((body.rules ?? []).map((rule) => rule.clientKey));
    if (meteredListeners.size === 0) return;
    if (next.size === meteredKeys.size && [...next].every((key) => meteredKeys.has(key))) return;
    meteredKeys = next;
    for (const listener of meteredListeners) listener();
  } catch {
    // The panel behind these marks reports a silent recorder on its own.
  }
}

function subscribeToMeteredKeys(listener: () => void): () => void {
  meteredListeners.add(listener);
  if (meteredTimerId === null) {
    void loadMeteredKeys();
    meteredTimerId = window.setInterval(() => void loadMeteredKeys(), REFRESH_MS);
  }
  return () => {
    meteredListeners.delete(listener);
    if (meteredListeners.size > 0) return;
    if (meteredTimerId !== null) {
      window.clearInterval(meteredTimerId);
      meteredTimerId = null;
    }
    meteredKeys = new Set();
  };
}

export function useMeteredKeys(): Set<string> {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => meteredKeys,
    () => meteredKeys,
  );
}
