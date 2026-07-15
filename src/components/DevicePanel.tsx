// Hardware, alignment, GPS, and network facts from the live status message.

import type { DishStatusJson } from "../lib/dishClient";
import { formatUptime } from "../lib/format";

function humanizeAlertKey(alertKey: string): string {
  return alertKey.replace(/([A-Z])/g, " $1").toLowerCase().trim();
}

interface DeviceFact {
  label: string;
  value: string;
}

export function DevicePanel({ status, embedded = false }: { status: DishStatusJson; embedded?: boolean }) {
  const alignment = status.alignmentStats;
  const activeAlerts = Object.entries(status.alerts ?? {})
    .filter(([, isActive]) => isActive)
    .map(([alertKey]) => humanizeAlertKey(alertKey));

  const facts: DeviceFact[] = [
    { label: "Hardware", value: status.deviceInfo?.hardwareVersion ?? "—" },
    { label: "Firmware", value: status.deviceInfo?.softwareVersion ?? "—" },
    { label: "Country", value: status.deviceInfo?.countryCode ?? "—" },
    { label: "Uptime", value: formatUptime(Number(status.deviceState?.uptimeS ?? 0)) },
    { label: "Boot count", value: String(status.deviceInfo?.bootcount ?? "—") },
    { label: "Service class", value: (status.classOfService ?? "—").toLowerCase() },
    {
      label: "GPS",
      value: status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix",
    },
    { label: "Ethernet link", value: status.ethSpeedMbps ? `${status.ethSpeedMbps} Mbps` : "—" },
    { label: "Mesh routers", value: String(status.connectedRouters?.length ?? 0) },
    {
      label: "Boresight",
      value: alignment
        ? `az ${alignment.boresightAzimuthDeg?.toFixed(1)}° · el ${alignment.boresightElevationDeg?.toFixed(1)}°`
        : "—",
    },
    { label: "Tilt", value: alignment?.tiltAngleDeg !== undefined ? `${alignment.tiltAngleDeg.toFixed(1)}°` : "—" },
    { label: "Software update", value: (status.softwareUpdateState ?? "—").toLowerCase() },
  ];

  return (
    <div className={embedded ? "" : "card span-12"}>
      <div className="card-header">
        {!embedded && <span className="card-title">Terminal</span>}
        <span className="card-meta mono-value">{status.deviceInfo?.id ?? ""}</span>
      </div>
      <div className={embedded ? "device-grid device-grid-narrow" : "device-grid"}>
        {facts.map((fact) => (
          <div className="device-row" key={fact.label}>
            <span className="device-label">{fact.label}</span>
            <span className="mono-value">{fact.value}</span>
          </div>
        ))}
      </div>
      {activeAlerts.length > 0 && (
        <div className="alert-chips">
          {activeAlerts.map((alertName) => (
            <span className="alert-chip" key={alertName}>
              ⚠ {alertName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
