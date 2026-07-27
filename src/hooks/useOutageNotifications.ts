// Watches telemetry for the Starlink-side stories worth interrupting a user for:
//   - an outage in progress: the dish is reachable but its pings to the PoP are
//     failing, so the satellite side is down while the hardware here is fine
//   - recovery: those pings succeeding again
//   - an outage the dish itself logged and we had not already seen
//
// Losing contact with the dish is not one of them. That is an alert about this
// machine's own reach, and useDeviceAlerts owns every alert-shaped notification
// so that exactly one place decides what is worth a chime and a banner.

import { useEffect, useRef } from "react";
import type { DishTelemetry } from "./useDishTelemetry";
import { sendNotification } from "../lib/notifications";
import { outageEventKind, outageEventLabel } from "@core/telemetry";
import { formatDurationMs } from "../lib/format";

export function useOutageNotifications(telemetry: DishTelemetry): void {
  const lastSeenOutageStartRef = useRef(0);
  const wasDroppingRef = useRef(false);

  // Losing contact with the dish is NOT handled here, though it used to be. It
  // is an alert (`dishUnreachable`), and useDeviceAlerts is the one place that
  // decides what is worth interrupting someone for — it raises it, chimes, and
  // notifies, only once the failures are sustained. A second notification path
  // firing off the raw connection state meant the threshold there bought
  // nothing: the first failed poll still put a notification on screen.

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
    // Only the entries that were actually outages. The same log carries link
    // and informational events, and announcing one as "Outage recorded: device
    // switched WiFi band" both cries wolf and spends the throttle that a real
    // outage arriving a minute later would have needed.
    const outages = telemetry.outageEvents.filter(
      (event) => outageEventKind(event.cause) === "outage",
    );
    if (outages.length === 0) return;
    const newestOutage = outages.reduce((latest, outage) =>
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
