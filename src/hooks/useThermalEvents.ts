// Dish thermal alerts, in two halves.
//
// The dish reports thermal state as live booleans on get_status → alerts and
// keeps no history of its own: once a flag clears, the episode is gone. The
// collector watches for the edges and writes them to a durable log, so the
// event list survives a reload and covers the hours no browser was open — this
// hook just reads that log back. Notifications come off the live status
// instead, since those only mean anything while a tab is actually open.
//
// There is no dish temperature to pair with these: the numeric sensors
// (modem_asic_temp, tx_if_temp) live on TransceiverGetStatus, which this
// firmware answers with Unimplemented. The flags are the whole signal.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DishStatusJson } from "../lib/dishClient";
import type { OutageEvent } from "../lib/telemetry";
import { sendNotification } from "../lib/notifications";

interface ThermalAlertSpec {
  /** Key on `alerts`, as emitted by the protobuf JSON mapping. */
  alertKey: string;
  cause: string;
  severity: OutageEvent["severity"];
  onsetTitle: string;
  onsetBody: string;
  clearedTitle: string;
  clearedBody: string;
}

const THERMAL_ALERTS: ThermalAlertSpec[] = [
  {
    alertKey: "thermalShutdown",
    cause: "thermal shutdown",
    severity: "critical",
    onsetTitle: "Dish thermal shutdown",
    onsetBody: "The dish has shut itself down to avoid overheating. Service stays offline until it cools.",
    clearedTitle: "Dish thermal shutdown ended",
    clearedBody: "The dish has cooled enough to come back online.",
  },
  {
    alertKey: "thermalThrottle",
    cause: "thermal throttle",
    severity: "warning",
    onsetTitle: "Dish thermally throttled",
    onsetBody: "The dish is hot and is limiting performance to cool down. Expect reduced speeds.",
    clearedTitle: "Dish thermal throttling ended",
    clearedBody: "The dish has cooled down and is back to full performance.",
  },
  {
    alertKey: "powerSupplyThermalThrottle",
    cause: "power supply thermal throttle",
    severity: "warning",
    onsetTitle: "Power supply thermally throttled",
    onsetBody: "The dish's power supply is hot and is limiting output. Check for airflow around it.",
    clearedTitle: "Power supply throttling ended",
    clearedBody: "The dish's power supply has cooled back to normal.",
  },
];

const SPEC_BY_ALERT_KEY = new Map(THERMAL_ALERTS.map((spec) => [spec.alertKey, spec]));
const REFRESH_MS = 30_000;

interface ThermalEpisodeJson {
  alertKey: string;
  startMs: number;
  endMs: number | null;
}

/** Browser notifications on the live thermal flags, on the way in and out. */
export function useThermalNotifications(status: DishStatusJson | null): void {
  // alertKey -> currently set? Seeded lazily so the first observation can fire:
  // if the dish is already throttling when the app opens, that is worth saying.
  const wasActiveRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    // An unreachable dish means no reading, not a cleared alert.
    if (!status) return;
    const alerts = status.alerts ?? {};
    for (const spec of THERMAL_ALERTS) {
      const isActive = alerts[spec.alertKey] === true;
      const wasActive = wasActiveRef.current.get(spec.alertKey) ?? false;
      if (isActive && !wasActive) {
        sendNotification(`thermal-${spec.alertKey}`, spec.onsetTitle, spec.onsetBody);
      }
      if (!isActive && wasActive) {
        // Distinct kind from the onset, so a clear is never swallowed by the
        // per-kind notification throttle.
        sendNotification(`thermal-${spec.alertKey}-cleared`, spec.clearedTitle, spec.clearedBody);
      }
      wasActiveRef.current.set(spec.alertKey, isActive);
    }
  }, [status]);
}

/**
 * Thermal episodes from the collector's durable log, shaped as OutageEvents for
 * the events log. Empty when the collector isn't running.
 */
export function useThermalEvents(): OutageEvent[] {
  const [episodes, setEpisodes] = useState<ThermalEpisodeJson[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch("/api/thermal", { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) return;
        const body = (await response.json()) as { episodes?: ThermalEpisodeJson[] };
        if (!disposed) setEpisodes(body.episodes ?? []);
      } catch {
        // collector down: the dish's own events still populate the log
      }
    };
    load();
    const timerId = window.setInterval(load, REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  return useMemo(() => {
    const nowMs = Date.now();
    return episodes.flatMap((episode) => {
      const spec = SPEC_BY_ALERT_KEY.get(episode.alertKey);
      if (!spec) return [];
      const isOngoing = episode.endMs === null;
      return [
        {
          startMs: episode.startMs,
          durationMs: (episode.endMs ?? nowMs) - episode.startMs,
          cause: isOngoing ? `${spec.cause} (ongoing)` : spec.cause,
          severity: spec.severity,
        },
      ];
    });
  }, [episodes]);
}
