// One device's data allowance, from the historian's rule store.
//
// The rule rides its own request rather than the roster: it changes when someone
// edits it, not on the router's cadence, and the card that shows it is open far
// less often than the network panel behind it.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MeterCycle, MeterRule } from "@core/dataMeter";
import { apiRequest } from "../lib/apiHost";
import { meterIndicatorForRule, type MeterIndicator } from "../components/network/meterIndicator";

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

export function cycleParams(cycle: MeterCycle): Record<string, string> {
  switch (cycle.kind) {
    case "weekly":
      return { cycle: cycle.kind, weekday: String(cycle.weekday) };
    case "monthly":
    case "billing":
      return { cycle: cycle.kind, day: String(cycle.day) };
    case "custom":
      return { cycle: cycle.kind, days: String(cycle.days), start: String(cycle.startMs) };
    case "daily":
    case "once":
      return { cycle: cycle.kind };
  }
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

let meterIndicators = new Map<string, MeterIndicator>();
let trippedMeters: MeterRuleView[] = [];
let metersEnforceable = false;
const meteredListeners = new Set<() => void>();
let meteredTimerId: number | null = null;

function meterIndicatorSignature(marks: Map<string, MeterIndicator>): string {
  return [...marks].map(([key, mark]) => `${key}:${mark}`).join();
}

function trippedSignature(rules: readonly MeterRuleView[], enforceable: boolean): string {
  return rules
    .map((rule) => `${rule.clientKey}:${rule.allocationBytes}:${rule.deviceName}:${enforceable}`)
    .join();
}

async function loadMeteredKeys(): Promise<void> {
  try {
    const response = await apiRequest("/api/clients/meters");
    if (!response.ok) return;
    const body = (await response.json()) as {
      rules?: MeterRuleView[];
      pauseEnforceable?: boolean;
    };
    const rules = body.rules ?? [];
    const nextEnforceable = body.pauseEnforceable === true;
    if (meteredListeners.size === 0) return;
    const nextIndicators = new Map(
      rules.map((rule) => [rule.clientKey, meterIndicatorForRule(rule)] as const),
    );
    const indicatorsMoved =
      meterIndicatorSignature(nextIndicators) !== meterIndicatorSignature(meterIndicators);
    // The recorder owns when an announcement retires, so this reads its stamp
    // rather than re-deciding off usage: usage stays over the allowance for the
    // rest of the cycle, and nothing here re-renders on a timer to notice.
    const nextTripped = rules.filter((rule) => rule.reachedAtMs !== undefined);
    const trippedMoved =
      trippedSignature(nextTripped, nextEnforceable) !==
      trippedSignature(trippedMeters, metersEnforceable);
    if (!indicatorsMoved && !trippedMoved) return;
    if (indicatorsMoved) meterIndicators = nextIndicators;
    if (trippedMoved) {
      trippedMeters = nextTripped;
      metersEnforceable = nextEnforceable;
    }
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
    meterIndicators = new Map();
    trippedMeters = [];
    metersEnforceable = false;
  };
}

/** Whether the recorder behind these rules can actually pause a device. */
export function useMetersEnforceable(): boolean {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => metersEnforceable,
    () => metersEnforceable,
  );
}

export function useMeterIndicators(): Map<string, MeterIndicator> {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => meterIndicators,
    () => meterIndicators,
  );
}

/** Rules that have reached their allowance this cycle. The wording an alert
 *  needs names one device, so no static definition can carry it and the alert
 *  surfaces are built from these instead. */
export function useTrippedMeters(): MeterRuleView[] {
  return useSyncExternalStore(
    subscribeToMeteredKeys,
    () => trippedMeters,
    () => trippedMeters,
  );
}
