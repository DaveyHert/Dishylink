// Sticky instrument header: wordmark, live connection state, dish identity,
// theme toggle.

import type { DishConnectionState } from "../../hooks/useDishTelemetry";
import type { DishStatusJson } from "../../lib/dishClient";
import { formatUptime } from "../../lib/format";
import { AlertsBell } from "../alerts/AlertsBell";
import { AppLogo } from "../icons/AppLogo";
import type { DeviceAlerts } from "../../hooks/useDeviceAlerts";

interface TopBarProps {
  connectionState: DishConnectionState;
  status: DishStatusJson | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  deviceAlerts: DeviceAlerts;
  notificationsOn: boolean;
  onToggleNotifications: () => void;
  onOpenSpeedTest: () => void;
  onOpenAlignment: () => void;
  onOpenDataUsage: () => void;
  onOpenNetwork: () => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
}

const CONNECTION_LABEL: Record<DishConnectionState, string> = {
  connecting: "connecting",
  online: "online",
  unreachable: "dish unreachable",
};

// Nav text button, read-only status readouts (divider-separated, no button feel),
// and round icon button — repeated in the header.
const navLink =
  "cursor-pointer border-0 bg-transparent p-0 font-sans text-[14px] font-semibold text-[var(--ink-secondary)] transition-colors hover:text-foreground";
const statusItem =
  "inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-medium text-[var(--ink-secondary)]";
const statusDivider = "border-l border-[var(--baseline)] pl-2.5";
const iconButton =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-card text-[var(--ink-secondary)] transition-colors hover:text-foreground";

export function TopBar({
  connectionState,
  status,
  theme,
  onToggleTheme,
  deviceAlerts,
  notificationsOn,
  onToggleNotifications,
  onOpenSpeedTest,
  onOpenAlignment,
  onOpenDataUsage,
  onOpenNetwork,
  onOpenAccount,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 bg-[color-mix(in_srgb,var(--page)_86%,transparent)] px-6 py-3.5 backdrop-blur-[10px]">
      <div className="flex items-center gap-[11px]">
        <AppLogo size={28} className="flex-none" />
        <span className="text-[17px] font-bold tracking-[0.16em]">DISHYLINK</span>
        <span className="ml-0.5 border-l border-[var(--baseline)] pl-2.5 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground">
          LIVE STARLINK TELEMETRY
        </span>
      </div>
      <nav className="mr-auto ml-3.5 flex items-center gap-[22px]">
        <button className={navLink} onClick={onOpenSpeedTest}>
          Speed test
        </button>
        <button className={navLink} onClick={onOpenAlignment}>
          Alignment
        </button>
        <button className={navLink} onClick={onOpenDataUsage}>
          Data usage
        </button>
        <button className={navLink} onClick={onOpenNetwork}>
          Network
        </button>
        <button className={navLink} onClick={onOpenAccount}>
          Account
        </button>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <span className={statusItem}>
            <span className={`status-dot ${connectionState}`} />
            {CONNECTION_LABEL[connectionState]}
          </span>
          {status?.deviceInfo?.countryCode && (
            <span className={`${statusItem} ${statusDivider}`}>{status.deviceInfo.countryCode}</span>
          )}
          {status?.deviceState?.uptimeS && (
            <span className={`${statusItem} ${statusDivider}`}>up {formatUptime(Number(status.deviceState.uptimeS))}</span>
          )}
        </div>
        <AlertsBell
          alerts={deviceAlerts}
          notificationsOn={notificationsOn}
          onToggleNotifications={onToggleNotifications}
        />
        <button className={iconButton} onClick={onOpenSettings} aria-label="Open settings" title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          className={iconButton}
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
