// Sticky status strip: wordmark on the left; live connection state, dish
// identity, alerts and the theme toggle on the right. Below 1080px the secondary
// status readouts (country, uptime) drop so the strip stays on one line.

import { MoonIcon } from "../../assets/icons/MoonIcon";
import { SunIcon } from "../../assets/icons/SunIcon";
import type { DishConnectionState } from "../../hooks/useDishTelemetry";
import type { DishStatusJson } from "@core/dishClient";
import { formatUptime } from "../../lib/format";
import { AlertsMenu } from "../alerts/AlertsMenu";
import { SupportMenu } from "../shared/SupportMenu";
import { AppLogo } from "../../assets/icons/AppLogo";
import type { DeviceAlerts } from "../../hooks/useDeviceAlerts";

interface TopBarProps {
  connectionState: DishConnectionState;
  status: DishStatusJson | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  deviceAlerts: DeviceAlerts;
  notificationsOn: boolean;
  notificationsBlockedReason: string | null;
  onToggleNotifications: () => void;
}

const CONNECTION_LABEL: Record<DishConnectionState, string> = {
  connecting: "connecting",
  online: "online",
  unreachable: "dish unreachable",
};

// The status dot: a 7px disc that pulses while the link is live or being found,
// and sits still once the dish is unreachable.
const statusDot = "size-[7px] flex-none rounded-full";
const CONNECTION_DOT: Record<DishConnectionState, string> = {
  connecting: "bg-[var(--ink-muted)] animate-[status-pulse_1s_ease-in-out_infinite]",
  online: "bg-[var(--status-good)] animate-[status-pulse_2.2s_ease-in-out_infinite]",
  unreachable: "bg-[var(--status-critical)]",
};

// Read-only status readouts (divider-separated, no button feel) and round icon
// button — repeated in the strip.
const statusItem =
  "inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-medium text-(--ink-secondary)";
const statusDivider = "border-l border-input pl-2.5";
const iconButton =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-card text-(--ink-secondary) transition-colors hover:text-foreground";

export function TopBar({
  connectionState,
  status,
  theme,
  onToggleTheme,
  deviceAlerts,
  notificationsOn,
  notificationsBlockedReason,
  onToggleNotifications,
}: TopBarProps) {
  return (
    <header className='sticky top-0 z-20 flex items-center justify-between gap-4 bg-gradient-to-b from-[color-mix(in_srgb,var(--page)_72%,transparent)] via-[color-mix(in_srgb,var(--page)_42%,transparent)] to-transparent px-6 pt-3.5 pb-4'>
      <div className='flex min-w-0 items-center gap-[11px]'>
        <AppLogo size={28} className='flex-none' />
        <span className='text-[17px] font-bold tracking-[0.16em]'>DISHYLINK</span>
      </div>
      <div className='flex flex-none flex-wrap items-center justify-end gap-3'>
        <div className='flex items-center gap-2.5'>
          <span className={statusItem}>
            <span className={`${statusDot} ${CONNECTION_DOT[connectionState]} `} />
            {CONNECTION_LABEL[connectionState]}
          </span>
          {status?.deviceInfo?.countryCode && (
            <span className={`${statusItem} ${statusDivider}`}>
              {status.deviceInfo.countryCode}
            </span>
          )}
          {status?.deviceState?.uptimeS && (
            <span className={`${statusItem} ${statusDivider}`}>
              up {formatUptime(Number(status.deviceState.uptimeS))}
            </span>
          )}
        </div>

        <AlertsMenu
          alerts={deviceAlerts}
          notificationsOn={notificationsOn}
          notificationsBlockedReason={notificationsBlockedReason}
          onToggleNotifications={onToggleNotifications}
        />
        <SupportMenu />
        <button
          className={iconButton}
          onClick={onToggleTheme}
          aria-label='Toggle color theme'
          title='Toggle color theme'
        >
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  );
}
