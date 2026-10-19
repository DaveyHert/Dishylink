// Dish thermal alerts, in two halves.
//
// The dish reports thermal state as live booleans on get_status → alerts and
// keeps no history of its own: once a flag clears, the episode is gone. The
// historian watches for the edges and writes them to a durable log, so the
// event list survives a reload and covers the hours no browser was open — this
// hook just reads that log back. Notifications come off the live status
// instead, since those only mean anything while a tab is actually open.
//
// There is no dish temperature to pair with these: the numeric sensors
// (modem_asic_temp, tx_if_temp) live on TransceiverGetStatus, which this
// firmware answers with Unimplemented. The flags are the whole signal.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNow } from "./useNow";
import { usePolledEndpoint } from "./usePolledEndpoint";
import type { OutageEvent } from "@core/telemetry";
import type { TranslationKey } from "@core/i18n/resources";

interface ThermalAlertSpec {
  /** Key on `alerts`, as emitted by the protobuf JSON mapping. */
  alertKey: string;
  /** The row's title in the events log; it doubles as the event's cause. */
  cause: TranslationKey;
  severity: OutageEvent["severity"];
}

const THERMAL_ALERTS: ThermalAlertSpec[] = [
  {
    alertKey: "thermalShutdown",
    cause: "events.thermalShutdownEpisode",
    severity: "critical",
  },
  {
    alertKey: "thermalThrottle",
    cause: "events.thermalThrottleEpisode",
    severity: "warning",
  },
  {
    alertKey: "powerSupplyThermalThrottle",
    cause: "events.powerSupplyThermalThrottleEpisode",
    severity: "warning",
  },
];

const SPEC_BY_ALERT_KEY = new Map(THERMAL_ALERTS.map((spec) => [spec.alertKey, spec]));

/** The episode's name in the user's language, or the raw key for one the
 *  catalog does not know. */
export function thermalEpisodeLabel(alertKey: string, t: TFunction): string {
  const spec = SPEC_BY_ALERT_KEY.get(alertKey);
  return spec ? t(spec.cause) : alertKey;
}

interface ThermalEpisodeJson {
  alertKey: string;
  startMs: number;
  endMs: number | null;
}

const NO_EPISODES: ThermalEpisodeJson[] = [];

function pickEpisodes(body: unknown): ThermalEpisodeJson[] {
  return (body as { episodes?: ThermalEpisodeJson[] }).episodes ?? NO_EPISODES;
}

/**
 * Thermal episodes from the historian's durable log, shaped as OutageEvents for
 * the events log. Empty when the historian isn't running.
 */
export function useThermalEvents(): OutageEvent[] {
  const { t } = useTranslation();
  const episodes = usePolledEndpoint("/api/thermal", pickEpisodes, NO_EPISODES);
  // An episode still running has no end, so its duration is measured against now
  // and grows while it runs. Taken from the ticking clock so it actually advances
  // on screen; read straight from Date.now() it would sit at whatever it was when
  // something unrelated last caused a render. Durations show seconds, so it ticks
  // every second.
  const nowMs = useNow();

  return useMemo(() => {
    return episodes.flatMap((episode) => {
      const spec = SPEC_BY_ALERT_KEY.get(episode.alertKey);
      if (!spec) return [];
      const isOngoing = episode.endMs === null;
      const label = t(spec.cause);
      return [
        {
          startMs: episode.startMs,
          durationMs: (episode.endMs ?? nowMs) - episode.startMs,
          cause: isOngoing ? t("events.ongoing", { label }) : label,
          severity: spec.severity,
        },
      ];
    });
  }, [episodes, nowMs, t]);
}
