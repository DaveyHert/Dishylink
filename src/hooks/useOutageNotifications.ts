// Announces a Starlink-side outage in a plain browser tab: the dish is powered
// and reachable, and its pings to the point of presence are not coming back.
//
// Only in a tab. On the desktop the recorder in the main process watches the
// same drop rate and announces it whether or not a window exists, so this would
// be a second voice saying the same thing — see hostAnnouncesAlerts.
//
// Two things it deliberately does NOT announce:
//
// Losing contact with the dish. That is an alert about this machine's own reach
// (`dishUnreachable`), and useDeviceAlerts owns every alert-shaped notification
// so exactly one place decides what is worth interrupting someone for.
//
// Outages the dish logged in its own history. Those are the same events this
// already reports live, arriving a second time by a slower route — the log is
// what fills the History tab, not a second reason to interrupt someone. It used
// to notify from both, which meant one outage produced two notifications with
// two different wordings, and needed a freshness window and a first-observation
// skip to stop a full ring buffer announcing itself at startup. All of that was
// the cost of the second path, not of the problem.

import { useEffect, useRef } from "react";
import type { DishTelemetry } from "./useDishTelemetry";
import { hostAnnouncesAlerts, sendNotification } from "../lib/notifications";
import { isStarlinkOutage } from "@core/telemetry";
import { useTranslation } from "react-i18next";

export function useOutageNotifications(telemetry: DishTelemetry): void {
  const { t } = useTranslation();
  const wasDroppingRef = useRef(false);

  // The rule for what counts as an outage lives in core, so this and the
  // recorder cannot reach different conclusions about the same run of samples.
  useEffect(() => {
    if (hostAnnouncesAlerts()) return;
    const isDropping = isStarlinkOutage(telemetry.samples);
    if (isDropping && !wasDroppingRef.current) {
      sendNotification(
        "starlink-outage",
        t("notifications.outageTitle"),
        t("notifications.outageBody"),
      );
    }
    if (!isDropping && wasDroppingRef.current) {
      sendNotification(
        "recovered",
        t("notifications.restoredTitle"),
        t("notifications.restoredBody"),
      );
    }
    wasDroppingRef.current = isDropping;
  }, [telemetry.samples, t]);
}
