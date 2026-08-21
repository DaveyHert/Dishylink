// Allowances set across several devices, from the recorder's group store.
//
// A group carries its terms and its membership, nothing derived: what a member
// has spent is on that member's own rule, which /api/clients/meters already
// serves. Two places holding one figure is two places for it to disagree.

import { useCallback, useEffect, useState } from "react";
import type { MeterCycle } from "@core/dataMeter";
import type { DeviceGroup, GroupAllowanceMode } from "@core/deviceGroup";
import { formatScheduleParam, type Schedule } from "@core/schedule";
import { apiRequest } from "../lib/apiHost";
import { cycleParams, refreshMeterIndicators } from "./useDataMeter";

const REFRESH_MS = 10_000;

export interface DeviceGroupTerms {
  groupId?: string;
  name: string;
  memberKeys: string[];
  allocationBytes: number;
  autoPause: boolean;
  cycle: MeterCycle;
  mode: GroupAllowanceMode;
  countdownMs?: number;
  schedule?: Schedule;
}

export interface DeviceGroups {
  groups: DeviceGroup[];
  pauseEnforceable: boolean;
  loading: boolean;
  error: string | null;
  save: (terms: DeviceGroupTerms) => Promise<void>;
  remove: (groupId: string) => Promise<void>;
}

export function useDeviceGroups(): DeviceGroups {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [pauseEnforceable, setPauseEnforceable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/api/clients/groups");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        groups?: DeviceGroup[];
        pauseEnforceable?: boolean;
      };
      setGroups(body.groups ?? []);
      setPauseEnforceable(body.pauseEnforceable === true);
      setError(null);
    } catch {
      setError("The recorder isn’t answering, so groups can’t be read or changed.");
    } finally {
      setLoading(false);
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

  const write = useCallback(
    async (path: string, method = "POST") => {
      try {
        const response = await apiRequest(path, { method });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setError(null);
      } catch {
        setError("The recorder refused the change.");
      } finally {
        // A group write is what sets its members' rules, and nothing polling
        // those knows it happened.
        await Promise.all([load(), refreshMeterIndicators()]);
      }
    },
    [load],
  );

  const save = useCallback(
    async (terms: DeviceGroupTerms) => {
      const query = new URLSearchParams({
        name: terms.name,
        members: terms.memberKeys.join(","),
        allocation: String(Math.round(terms.allocationBytes)),
        autoPause: terms.autoPause ? "1" : "0",
        mode: terms.mode,
        ...cycleParams(terms.cycle),
        ...(terms.groupId ? { group: terms.groupId } : {}),
        ...(terms.countdownMs === undefined
          ? {}
          : { countdown: String(Math.round(terms.countdownMs)) }),
        ...(terms.schedule === undefined ? {} : { schedule: formatScheduleParam(terms.schedule) }),
      });
      await write(`/api/clients/groups?${query.toString()}`);
    },
    [write],
  );

  const remove = useCallback(
    async (groupId: string) => {
      await write(`/api/clients/groups?group=${encodeURIComponent(groupId)}`, "DELETE");
    },
    [write],
  );

  return { groups, pauseEnforceable, loading, error, save, remove };
}
