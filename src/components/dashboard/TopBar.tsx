// Sticky instrument header: wordmark, live connection state, dish identity,
// theme toggle. Below 1080px (the app's one mobile breakpoint) the five nav
// links fold into a hamburger Popover, the tagline and secondary status
// readouts hide, and only the connection dot and the icon controls stay inline —
// so nothing spills off-screen the way the single non-wrapping row used to.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SpeedometerIcon } from "../../assets/icons/SpeedometerIcon";
import { CrosshairIcon } from "../../assets/icons/CrosshairIcon";
import { ChartLineIcon } from "../../assets/icons/ChartLineIcon";
import { NetworkIcon } from "../../assets/icons/NetworkIcon";
import { UserIcon } from "../../assets/icons/UserIcon";
import { MenuIcon } from "../../assets/icons/MenuIcon";
import { SettingsIcon } from "../../assets/icons/SettingsIcon";
import { MoonIcon } from "../../assets/icons/MoonIcon";
import { SunIcon } from "../../assets/icons/SunIcon";
import type { DishConnectionState } from "../../hooks/useDishTelemetry";
import type { DishStatusJson } from "@core/dishClient";
import { formatUptime } from "../../lib/format";
import { AlertsMenu } from "../alerts/AlertsMenu";
import { AppLogo } from "../../assets/icons/AppLogo";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
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
  onOpenSpeedTest: () => void;
  onOpenAlignment: () => void;
  onOpenDataUsage: () => void;
  onOpenNetwork: () => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  onOpenSatellite: () => void;
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

// Nav text button, read-only status readouts (divider-separated, no button feel),
// and round icon button — repeated in the header.
const navLink =
  "cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-sans text-[14px] font-semibold text-[var(--ink-secondary)] transition-colors hover:text-foreground";
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
  notificationsBlockedReason,
  onToggleNotifications,
  onOpenSpeedTest,
  onOpenAlignment,
  onOpenDataUsage,
  onOpenNetwork,
  onOpenAccount,
  onOpenSettings,
  onOpenSatellite,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // One source for the nav destinations, rendered inline on desktop and inside
  // the hamburger Popover on mobile so the two can't drift apart.
  const navItems = [
    { label: "Speed test", Icon: SpeedometerIcon, onClick: onOpenSpeedTest },
    { label: "Alignment", Icon: CrosshairIcon, onClick: onOpenAlignment },
    { label: "Data usage", Icon: ChartLineIcon, onClick: onOpenDataUsage },
    { label: "Network", Icon: NetworkIcon, onClick: onOpenNetwork },
    { label: "Account", Icon: UserIcon, onClick: onOpenAccount },
    // Temporary entry while the sky view is being built out.
    { label: "Satellite", Icon: CrosshairIcon, onClick: onOpenSatellite },
  ];

  return (
    <header className='sticky top-0 z-20 flex items-center justify-between gap-4 bg-[color-mix(in_srgb,var(--page)_86%,transparent)] px-6 py-3.5 backdrop-blur-[10px]'>
      <div className='flex min-w-0 flex-1 items-center gap-[11px]'>
        <AppLogo size={28} className='flex-none' />
        <span className='text-[17px] font-bold tracking-[0.16em]'>DISHYLINK</span>
        <nav className='ml-6 flex items-center gap-[22px] max-[1080px]:hidden'>
          {navItems.map((item) => (
            <button key={item.label} className={navLink} onClick={item.onClick}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className='flex flex-1 flex-wrap items-center justify-end gap-3'>
        <div className='flex items-center gap-2.5'>
          <span className={statusItem}>
            <span className={`${statusDot} ${CONNECTION_DOT[connectionState]}`} />
            {CONNECTION_LABEL[connectionState]}
          </span>
          {status?.deviceInfo?.countryCode && (
            <span className={`${statusItem} ${statusDivider} max-[1080px]:hidden`}>
              {status.deviceInfo.countryCode}
            </span>
          )}
          {status?.deviceState?.uptimeS && (
            <span className={`${statusItem} ${statusDivider} max-[1080px]:hidden`}>
              up {formatUptime(Number(status.deviceState.uptimeS))}
            </span>
          )}
        </div>

        {/* Mobile only: the inline nav folds into this menu below 1080px. */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(iconButton, "hidden max-[1080px]:inline-flex")}
              aria-label='Open navigation menu'
              title='Menu'
            >
              <MenuIcon />
            </button>
          </PopoverTrigger>
          {/* Same surface language as the bell popover: --surface, rounded-xl,
              hairline border (not the stock white one), soft shadow. */}
          <PopoverContent
            align='end'
            sideOffset={10}
            className='w-56 rounded-xl border border-solid border-[var(--hairline)] bg-[var(--surface)] p-1.5 text-[var(--ink)] shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
          >
            <nav className='flex flex-col'>
              {navItems.map((item) => (
                <button
                  key={item.label}
                  className='flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-[var(--ink)]'
                  onClick={() => {
                    item.onClick();
                    setMenuOpen(false);
                  }}
                >
                  <item.Icon size={16} className='flex-none' />
                  {item.label}
                </button>
              ))}
            </nav>
          </PopoverContent>
        </Popover>
        <AlertsMenu
          alerts={deviceAlerts}
          notificationsOn={notificationsOn}
          notificationsBlockedReason={notificationsBlockedReason}
          onToggleNotifications={onToggleNotifications}
        />
        <button
          className={iconButton}
          onClick={onOpenSettings}
          aria-label='Open settings'
          title='Settings'
        >
          <SettingsIcon />
        </button>
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
