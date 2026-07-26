// Watches telemetry for the three connection stories worth interrupting a
// user for, and says which one is happening:
//   - Starlink outage: dish reachable but pop pings failing (satellite side)
//   - local issue: the dish itself stopped answering on the LAN
//   - recovery: back online after either of the above

import { useEffect, useRef } from "react";
import type { DishTelemetry } from "./useDishTelemetry";
import { sendNotification } from "../lib/notifications";
import { outageEventLabel } from "../lib/telemetry";
import { formatDurationMs } from "../lib/format";

export function useOutageNotifications(telemetry: DishTelemetry): void {
  const previousConnectionRef = useRef(telemetry.connectionState);
  const lastSeenOutageStartRef = useRef(0);
  const wasDroppingRef = useRef(false);

  // dish reachable/unreachable transitions
  useEffect(() => {
    const previous = previousConnectionRef.current;
    const current = telemetry.connectionState;
    if (previous === "online" && current === "unreachable") {
      sendNotification(
        "dish-unreachable",
        "Dish unreachable",
        "DishyLink lost contact with the dish on your local network — check power and cabling. (This is a local issue, not a Starlink outage.)",
      );
    }
    if (previous === "unreachable" && current === "online") {
      sendNotification("recovered", "Dish back online", "Contact with the dish has been restored.");
    }
    previousConnectionRef.current = current;
  }, [telemetry.connectionState]);

  // Starlink-side outage: pings to the point of presence failing right now
  useEffect(() => {
    const recentSamples = telemetry.samples.slice(-8);
    if (recentSamples.length < 8) return;
    const isDropping = recentSamples.every((sample) => sample.dropRate >= 1);
    if (isDropping && !wasDroppingRef.current) {
      sendNotification(
        "starlink-outage",
        "Starlink outage in progress",
        "The dish is powered and reachable, but pings to the Starlink network are failing.",
      );
    }
    if (!isDropping && wasDroppingRef.current) {
      sendNotification(
        "recovered",
        "Starlink connection restored",
        "Pings to the Starlink network are succeeding again.",
      );
    }
    wasDroppingRef.current = isDropping;
  }, [telemetry.samples]);

  // new entries appended to the dish's own outage log
  useEffect(() => {
    if (telemetry.outageEvents.length === 0) return;
    const newestOutage = telemetry.outageEvents.reduce((latest, outage) =>
      outage.startMs > latest.startMs ? outage : latest,
    );
    const isFirstObservation = lastSeenOutageStartRef.current === 0;
    const isFresh = Date.now() - newestOutage.startMs < 5 * 60_000;
    if (!isFirstObservation && newestOutage.startMs > lastSeenOutageStartRef.current && isFresh) {
      const label = outageEventLabel(newestOutage.cause);
      sendNotification(
        "outage-event",
        `Outage recorded: ${label}`,
        `The dish logged a ${formatDurationMs(newestOutage.durationMs)} outage (${label}).`,
      );
    }
    lastSeenOutageStartRef.current = Math.max(lastSeenOutageStartRef.current, newestOutage.startMs);
  }, [telemetry.outageEvents]);
}
