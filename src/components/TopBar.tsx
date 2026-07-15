// Sticky instrument header: wordmark, live connection state, dish identity,
// theme toggle.

import type { DishConnectionState } from "../hooks/useDishTelemetry";
import type { DishStatusJson } from "../lib/dishClient";
import { formatUptime } from "../lib/format";

interface TopBarProps {
  connectionState: DishConnectionState;
  status: DishStatusJson | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  notificationsOn: boolean;
  onToggleNotifications: () => void;
  onOpenSpeedTest: () => void;
  onOpenAlignment: () => void;
}

const CONNECTION_LABEL: Record<DishConnectionState, string> = {
  connecting: "connecting",
  online: "online",
  unreachable: "dish unreachable",
};

export function TopBar({
  connectionState,
  status,
  theme,
  onToggleTheme,
  notificationsOn,
  onToggleNotifications,
  onOpenSpeedTest,
  onOpenAlignment,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wordmark-badge" />
        <span className="wordmark-name">DISHBOARD</span>
        <span className="wordmark-tag">LIVE STARLINK TELEMETRY</span>
      </div>
      <nav className="topbar-nav">
        <button className="topbar-link" onClick={onOpenSpeedTest}>
          Speed test
        </button>
        <button className="topbar-link" onClick={onOpenAlignment}>
          Alignment
        </button>
      </nav>
      <div className="topbar-right">
        <span className="chip">
          <span className={`status-dot ${connectionState}`} />
          {CONNECTION_LABEL[connectionState]}
        </span>
        {status?.deviceInfo?.countryCode && <span className="chip">{status.deviceInfo.countryCode}</span>}
        {status?.deviceState?.uptimeS && (
          <span className="chip">up {formatUptime(Number(status.deviceState.uptimeS))}</span>
        )}
        <button
          className="theme-toggle"
          onClick={onToggleNotifications}
          aria-label="Toggle outage notifications"
          title={notificationsOn ? "Outage notifications on" : "Notify me about outages"}
          style={notificationsOn ? { color: "var(--status-good)" } : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </button>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label="Toggle color theme"
          title="Toggle color theme"
        >
          {theme === "light" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
