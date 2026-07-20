// The alerts menu in the topbar: a bell with a live count, opening a popover
// with three tabs — Active (firing now), History (the collector's log), and
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
import { ALERTS_TABS, ActiveTab, HistoryTab, StatusTab, type AlertsTab } from "./AlertsTabs";
import { SEVERITY_COLOR } from "./alertFormat";

const BTN_RESET = "cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit";

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
  { count: number; color: string } & React.ComponentPropsWithoutRef<"button">
>(function AlertsBellTrigger({ count, color, ...triggerProps }, ref) {
  return (
    <button
      ref={ref}
      className='theme-toggle relative'
      aria-label='Alerts and notifications'
      title={count > 0 ? `${count} active alert${count === 1 ? "" : "s"}` : "Alerts — all healthy"}
      style={count > 0 ? { color } : undefined}
      {...triggerProps}
    >
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' />
        <path d='M13.7 21a2 2 0 0 1-3.4 0' />
      </svg>
      {count > 0 && (
        <span
          className='absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-solid border-[var(--page)] px-1 text-[10px] font-bold leading-none text-white'
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
  onToggleNotifications,
}: {
  alerts: DeviceAlerts;
  notificationsOn: boolean;
  onToggleNotifications: () => void;
}) {
  const [tab, setTab] = useState<AlertsTab>("active");
  const { active, statusList, history, routerReachable, collectorUp, dishReachable, firstSeen } =
    alerts;
  const activeCount = active.length;
  const badgeColor = activeCount > 0 ? SEVERITY_COLOR[active[0].severity] : "var(--ink-muted)";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <AlertsBellTrigger count={activeCount} color={badgeColor} />
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={10}
        collisionPadding={12}
        className='w-[380px] overflow-hidden rounded-xl border border-solid border-[var(--hairline)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
      >
        <div className='flex items-center justify-between px-4 py-2'>
          <span className='text-[15px] font-semibold text-[var(--ink)]'>Alerts</span>
          {notificationsSupported() && (
            <button
              className={cn(BTN_RESET, "text-xs font-medium transition-colors")}
              style={{ color: notificationsOn ? "var(--status-good)" : "var(--ink-muted)" }}
              onClick={onToggleNotifications}
            >
              {notificationsOn ? "Notifications on" : "Enable notifications"}
            </button>
          )}
        </div>

        <div className='flex items-center gap-5 px-4'>
          {ALERTS_TABS.map(({ key, label }) => (
            <Fragment key={key}>
              {/* Status is the live health list, not an alert feed: set apart by a
                  short rule, the height of the text — not a full-height border. */}
              {key === "status" && (
                <span className='h-3.5 w-px shrink-0 bg-[var(--hairline)]' aria-hidden='true' />
              )}
              <button
                onClick={() => setTab(key)}
                className={cn(
                  BTN_RESET,
                  "-mb-px flex items-center gap-1.5 border-0 border-b-2 border-solid border-transparent py-1.5 text-[13px] transition-colors",
                  tab === key ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-muted)]",
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
          {tab === "active" && <ActiveTab active={active} history={history} firstSeen={firstSeen} />}
          {tab === "history" && <HistoryTab history={history} collectorUp={collectorUp} />}
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
