// The window's toolbar: the app's one piece of persistent chrome, sitting in the
// unified title bar area above the instrument.
//
// The window is the dashboard — there is no "dashboard" destination to travel
// to and nothing here is ever the current place, so these items carry no
// selected state. Each one presents a sheet over the instrument and returns to
// it; they are commands, not navigation. That is why this is a toolbar and not
// a nav rail or a row of links.
//
// The bar is translucent and the content scrolls beneath it, which is what makes
// the window read as one surface rather than as a page with a header stuck to
// it. It sets no background of its own beyond that wash, so whatever it floats
// over shows through.
//
// `trafficLightInset` is the seam for a frameless host: the desktop build runs
// `titleBarStyle: "hiddenInset"`, whose close/minimise/zoom buttons overlay the
// bar's leading edge, and the inset reserves that space. Left at 0 — the browser
// extension and the dev server, which draw their own chrome or none — the
// leading group starts flush and no space is wasted. `draggable` likewise: the
// bar is a window drag handle only where a window frame is missing, and the
// items opt out of dragging so they stay clickable.

import type { CSSProperties } from "react";
import { AppLogo } from "../../assets/icons/AppLogo";
import { SpeedometerIcon } from "../../assets/icons/SpeedometerIcon";
import { CrosshairIcon } from "../../assets/icons/CrosshairIcon";
import { ChartLineIcon } from "../../assets/icons/ChartLineIcon";
import { NetworkIcon } from "../../assets/icons/NetworkIcon";
import { UserIcon } from "../../assets/icons/UserIcon";
import { DomeIcon } from "../../assets/icons/DomeIcon";
import { SettingsIcon } from "../../assets/icons/SettingsIcon";
import { BellIcon } from "../../assets/icons/BellIcon";
import { MoonIcon } from "../../assets/icons/MoonIcon";
import { SunIcon } from "../../assets/icons/SunIcon";

/** Which sheet a toolbar item presents. */
export type SheetId = "speedtest" | "alignment" | "satellite" | "datausage" | "network" | "account";

export type ConnectionState = "connecting" | "online" | "unreachable";

interface ToolbarItem {
  id: SheetId;
  label: string;
  Icon: (props: { size?: number; className?: string }) => React.ReactElement;
}

// Ordered as the instrument is worked: the measurements taken against the dish
// first, then the network it feeds and the account behind it.
const ITEMS: ToolbarItem[] = [
  { id: "speedtest", label: "Speed test", Icon: SpeedometerIcon },
  { id: "alignment", label: "Alignment", Icon: CrosshairIcon },
  { id: "satellite", label: "Satellites", Icon: DomeIcon },
  { id: "datausage", label: "Data usage", Icon: ChartLineIcon },
  { id: "network", label: "Network", Icon: NetworkIcon },
  { id: "account", label: "Account", Icon: UserIcon },
];

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting",
  online: "Online",
  unreachable: "Dish unreachable",
};

// The status disc pulses while the link is live or being found, and sits still
// once the dish is unreachable.
const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: "bg-[var(--ink-muted)] animate-[status-pulse_1s_ease-in-out_infinite]",
  online: "bg-[var(--status-good)] animate-[status-pulse_2.2s_ease-in-out_infinite]",
  unreachable: "bg-[var(--status-critical)]",
};

// Toolbar button: an icon that takes a soft rounded fill under the pointer, the
// way a native toolbar item does. Labels ride alongside on a wide window and
// drop out on a narrow one, where `title` still names the command.
const toolbarButton =
  "group relative inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[7px] border-0 bg-transparent px-2 font-sans text-[13px] font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_9%,transparent)] hover:text-[var(--ink)] active:bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]";

const iconButton =
  "inline-flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-[7px] border-0 bg-transparent text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_9%,transparent)] hover:text-[var(--ink)] active:bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]";

const separator = "h-[18px] w-px flex-none bg-[var(--hairline)]";

interface AppToolbarProps {
  onPresent: (sheet: SheetId) => void;
  connectionState: ConnectionState;
  /** Already-formatted dish uptime, shown beside the link state. */
  uptimeLabel?: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAlerts: () => void;
  /** Unresolved alerts, badged on the bell. */
  alertCount?: number;
  /** Leading space reserved for a frameless window's own controls. */
  trafficLightInset?: number;
  /** Whether the bar acts as a window drag handle. */
  draggable?: boolean;
  /** Hides the item labels, leaving an icon-only bar. */
  compact?: boolean;
}

export function AppToolbar({
  onPresent,
  connectionState,
  uptimeLabel,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenAlerts,
  alertCount = 0,
  trafficLightInset = 0,
  draggable = false,
  compact = false,
}: AppToolbarProps) {
  // `as CSSProperties` because -webkit-app-region is an Electron property React's
  // style typings do not carry.
  const dragStyle = draggable ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const noDragStyle = draggable ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;

  return (
    <header
      style={{ ...dragStyle, paddingLeft: trafficLightInset || undefined }}
      className='sticky top-0 z-20 flex h-[52px] flex-none items-center gap-2 border-b border-solid border-[var(--hairline)] bg-[color-mix(in_srgb,var(--page)_72%,transparent)] px-3 backdrop-blur-[24px] backdrop-saturate-[180%]'
    >
      {/* Clips rather than overlaps: if the window is narrowed past what the
          commands need, the last of them is cut off by the trailing group
          instead of being drawn underneath it. */}
      <div style={noDragStyle} className='flex min-w-0 items-center gap-1 overflow-hidden'>
        <div className='flex flex-none items-center gap-[9px] pr-1 pl-1'>
          <AppLogo size={22} className='text-[var(--ink)]' />
          {!compact && (
            <span className='text-[13px] font-bold tracking-[0.15em] text-[var(--ink)]'>
              DISHYLINK
            </span>
          )}
        </div>
        <span className={separator} />
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type='button'
            title={item.label}
            onClick={() => onPresent(item.id)}
            className={toolbarButton}
          >
            <item.Icon size={16} className='flex-none' />
            {!compact && <span className='whitespace-nowrap'>{item.label}</span>}
          </button>
        ))}
      </div>

      <div style={noDragStyle} className='ml-auto flex flex-none items-center gap-2 pl-2'>
        {/* Link state reads as a status readout, not a control: no button fill,
            no hover, nothing to press. On a narrow window it keeps the disc and
            drops the words, which `title` still carries — the two groups compete
            for one row, and the commands are what must stay legible. */}
        <span
          title={compact ? CONNECTION_LABEL[connectionState] : undefined}
          className='inline-flex items-center gap-[7px] pr-1 text-[12.5px] font-medium whitespace-nowrap text-[var(--ink-secondary)]'
        >
          <span className={`size-[7px] flex-none rounded-full ${CONNECTION_DOT[connectionState]}`} />
          {!compact && CONNECTION_LABEL[connectionState]}
          {!compact && uptimeLabel && connectionState === "online" && (
            <span className='text-[var(--ink-muted)]'>· up {uptimeLabel}</span>
          )}
        </span>
        <span className={separator} />
        <button
          className={`${iconButton} relative`}
          onClick={onOpenAlerts}
          aria-label={alertCount > 0 ? `Alerts, ${alertCount} unresolved` : "Alerts"}
          title='Alerts'
        >
          <BellIcon />
          {alertCount > 0 && (
            <span className='absolute top-[3px] right-[3px] size-[7px] rounded-full bg-[var(--status-critical)] ring-2 ring-[var(--page)]' />
          )}
        </button>
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
