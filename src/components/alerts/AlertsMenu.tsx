// The alerts menu in the topbar: a bell with a live count, opening a popover
// with three tabs — Active (firing now), History (the historian's log), and
// Status (every check on both devices, green when clear, like the dish's own
// Debug > Status list).
//
// Named for what it is rather than the glyph that opens it; the bell is only the
// trigger, and it is the one piece here that really is a bell.
//
// This project runs Tailwind without preflight, so buttons/borders aren't reset
// for us: interactive elements carry an explicit reset and borders are
// `border-solid`, otherwise shadcn's utility classes render as raw browser
// chrome. Colours come from the app's CSS tokens via arbitrary values.

import { Fragment, forwardRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { DeviceAlerts } from "../../hooks/useDeviceAlerts";
import { notificationsSupported } from "../../lib/notifications";
import {
  alertSoundEnabled,
  setAlertSoundEnabled,
  unlockAlertSound,
  playAlertSound,
} from "../../lib/alertSound";
import { BellIcon } from "../../assets/icons/BellIcon";
import { SpeakerIcon } from "../../assets/icons/SpeakerIcon";
import { ActiveTab, HistoryTab, StatusTab } from "./AlertsTabs";
import { ALERTS_TABS, type AlertsTab } from "./alertsPanelTabs";
import { SEVERITY_COLOR } from "./alertFormat";

const BTN_RESET = "cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit";

/** Mute/unmute for the alert chime. Chime and notifications are separate
 *  channels on purpose — sound works even where notifications are blocked —
 *  so each gets its own control. Unmuting sounds one soft note: the click is
 *  the unlock gesture browsers require, and it proves the volume immediately
 *  instead of during the next outage. */
function SoundToggle({ soundOn, onToggle }: { soundOn: boolean; onToggle: () => void }) {
  return (
    <button
      className={cn(BTN_RESET, "flex items-center transition-colors")}
      // Not green: that's the online indicator's color, and this is a
      // preference, not a health state. Ink when on, dimmed when muted.
      style={{ color: soundOn ? "var(--ink)" : "var(--ink-muted)" }}
      aria-label={soundOn ? "Mute alert sounds" : "Unmute alert sounds"}
      title={soundOn ? "Alert sounds on — click to mute" : "Alert sounds muted — click to unmute"}
      onClick={onToggle}
    >
      <SpeakerIcon on={soundOn} />
    </button>
  );
}

/**
 * The bell itself, with the active-alert count riding on it.
 *
 * Must forward its ref and spread the rest of its props: Radix's `asChild`
 * hands the trigger's ref, click handler and aria state to whatever element it
 * wraps, and a component that quietly drops them leaves a bell that renders
 * perfectly and opens nothing.
 */
const AlertsBellTrigger = forwardRef<
  HTMLButtonElement,
  { count: number; color: string; muted: boolean } & React.ComponentPropsWithoutRef<"button">
>(function AlertsBellTrigger({ count, color, muted, ...triggerProps }, ref) {
  return (
    <button
      ref={ref}
      className='relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-card text-ink-secondary transition-colors duration-[120ms] hover:text-ink'
      aria-label='Alerts and notifications'
      title={
        (count > 0 ? `${count} active alert${count === 1 ? "" : "s"}` : "Alerts — all healthy") +
        (muted ? " · sounds muted" : "")
      }
      style={count > 0 ? { color } : undefined}
      {...triggerProps}
    >
      <BellIcon muted={muted} />
      {count > 0 && (
        <span
          className='absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-solid border-page px-1 text-[10px] font-bold leading-none text-white'
          style={{ background: color }}
        >
          {count}
        </span>
      )}
    </button>
  );
});

export function AlertsMenu({
  alerts,
  notificationsOn,
  notificationsBlockedReason,
  onToggleNotifications,
}: {
  alerts: DeviceAlerts;
  notificationsOn: boolean;
  notificationsBlockedReason: string | null;
  onToggleNotifications: () => void;
}) {
  const [tab, setTab] = useState<AlertsTab>("active");
  // Lifted to the menu so the bell's tooltip and the panel's speaker toggle
  // report the same muted state.
  const [soundOn, setSoundOn] = useState(alertSoundEnabled);
  const toggleSound = () => {
    const next = !soundOn;
    setAlertSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      unlockAlertSound();
      playAlertSound("advisory");
    }
  };
  const { active, statusList, history, routerReachable, historianUp, dishReachable, firstSeen } =
    alerts;
  const activeCount = active.length;
  const badgeColor = activeCount > 0 ? SEVERITY_COLOR[active[0].severity] : "var(--ink-muted)";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <AlertsBellTrigger count={activeCount} color={badgeColor} muted={!soundOn} />
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={10}
        collisionPadding={12}
        className='w-[380px] overflow-hidden rounded-xl border border-solid border-hairline dark:bg-card p-0 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
      >
        <div className='flex items-center justify-between px-4 py-2'>
          <span className='text-[15px] font-semibold text-ink'>Alerts</span>
          <span className='flex items-center gap-3.5'>
            <SoundToggle soundOn={soundOn} onToggle={toggleSound} />
            {notificationsSupported() && (
              <button
                className={cn(BTN_RESET, "text-xs font-medium transition-colors")}
                style={{ color: notificationsOn ? "var(--status-good)" : "var(--ink-muted)" }}
                onClick={onToggleNotifications}
              >
                {notificationsOn ? "Notifications on" : "Enable notifications"}
              </button>
            )}
          </span>
        </div>

        {/* Why an enable attempt was refused — so the toggle explains itself
            instead of reading as a click that did nothing. */}
        {notificationsBlockedReason && (
          <p className='px-4 pb-2 text-[11px] leading-snug text-ink-secondary'>
            {notificationsBlockedReason}
          </p>
        )}

        <div className='flex items-center gap-5 px-4'>
          {ALERTS_TABS.map(({ key, label }) => (
            <Fragment key={key}>
              {/* Status is the live health list, not an alert feed: set apart by a
                  short rule, the height of the text — not a full-height border. */}
              {key === "status" && (
                <span className='h-3.5 w-px shrink-0 bg-hairline' aria-hidden='true' />
              )}
              <button
                onClick={() => setTab(key)}
                className={cn(
                  BTN_RESET,
                  "-mb-px flex items-center gap-1.5 border-0 border-b-2 border-solid border-transparent py-1.5 text-[13px] transition-colors",
                  tab === key ? "font-semibold text-ink" : "text-ink-muted",
                )}
                style={tab === key ? { borderBottomColor: "var(--ink)" } : undefined}
              >
                {label}
                {key === "active" && activeCount > 0 && (
                  <span
                    className='flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white'
                    style={{ background: badgeColor }}
                  >
                    {activeCount}
                  </span>
                )}
              </button>
            </Fragment>
          ))}
        </div>

        <div className='thin-scroll max-h-[60vh] overflow-y-auto'>
          {tab === "active" && (
            <ActiveTab active={active} history={history} firstSeen={firstSeen} />
          )}
          {tab === "history" && <HistoryTab history={history} historianUp={historianUp} />}
          {tab === "status" && (
            <StatusTab
              statusList={statusList}
              dishReachable={dishReachable}
              routerReachable={routerReachable}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
