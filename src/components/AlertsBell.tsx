// The bell in the topbar, and the notification dropdown it opens: a shadcn
// popover with three tabs — Active (firing now), History (the collector's log),
// and Status (every check on both devices, green when clear, like the dish's own
// Debug > Status list).
//
// This project runs Tailwind without preflight, so buttons/borders aren't reset
// for us: interactive elements carry an explicit reset and borders are
// `border-solid`, otherwise shadcn's utility classes render as raw browser
// chrome. Colours come from the app's CSS tokens via arbitrary values.

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { InfoDot } from "./InfoDot";
import type { AlertHistoryEntry, DeviceAlerts } from "../hooks/useDeviceAlerts";
import type { AlertSeverity, AlertSource, AlertState } from "../lib/dishAlerts";
import { notificationsSupported } from "../lib/notifications";
import { EmptyState } from "./ui/empty-state";

const BTN_RESET = "cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit";

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: "var(--status-critical)",
  warning: "var(--chart-warm)",
  advisory: "var(--ink-muted)",
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  advisory: "Advisory",
};

function deviceLabel(source: AlertSource): string {
  return source === "dish" ? "Dish" : source === "router" ? "Router" : "System";
}

/** How long an episode ran — the fact history is actually for. */
function formatSpan(startMs: number, endMs: number): string {
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function relativeTime(atMs: number): string {
  const deltaS = Math.max(0, Math.round((Date.now() - atMs) / 1000));
  if (deltaS < 60) return "just now";
  const minutes = Math.round(deltaS / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Row({
  color,
  dim,
  title,
  meta,
  advice,
}: {
  color: string;
  dim?: boolean;
  title: string;
  meta?: string;
  /** What to do about it — an ⓘ beside the message, never inside it. Only worth
   *  offering while the alert is live; history passes none. */
  advice?: string;
}) {
  return (
    <div className='flex items-start gap-3 px-4 py-2.5'>
      {/* Centred against the title's first line, not nudged down by a guessed
          margin: the box matches the line height (13.5px × leading-snug), so the
          dot stays put if the type changes and never drifts to the middle of a
          title that wraps to two lines. */}
      <span className='flex h-[1.375em] shrink-0 items-center text-[13.5px]'>
        <span
          className='size-2 rounded-full'
          style={{ background: color, opacity: dim ? 0.4 : 1 }}
        />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-[13.5px] leading-snug text-[var(--ink)]'>
          {title}
          {/* Sits after the message, not inside it. The gap is on the wrapper —
              a bare InfoDot has none of its own (StatLabel's .info-label
              supplies it there), and it would otherwise butt against the text. */}
          {advice && (
            <span className='ml-1.5 inline-flex translate-y-[1px] align-middle'>
              <InfoDot tip={advice} />
            </span>
          )}
        </p>
        {meta && <p className='mt-0.5 text-xs text-[var(--ink-muted)]'>{meta}</p>}
      </div>
    </div>
  );
}

function ActiveTab({
  active,
  history,
  firstSeen,
}: {
  active: AlertState[];
  history: AlertHistoryEntry[];
  firstSeen: Map<string, number>;
}) {
  // Live alerts are bare booleans — the device sends no timestamp. The real
  // onset lives in the collector's still-open episode ("started 2h ago"); with
  // no episode (recorder down, or a client-raised alert) fall back to when this
  // tab first saw it, worded "seen" so it never overstates what we know.
  const openedAt = new Map(
    history.filter((e) => e.endMs === null).map((e) => [`${e.source}:${e.key}`, e.startMs]),
  );
  // Active is a feed of alerts, not a report on the hardware. Empty means there
  // is nothing to tell you — what the devices' checks currently say is Status's
  // job, and claiming it here would be this tab speaking for that one.
  if (active.length === 0) return <EmptyState className='px-4 py-8'>No active alerts.</EmptyState>;
  return (
    <>
      {active.map((a) => {
        const id = `${a.source}:${a.key}`;
        const startedMs = openedAt.get(id);
        const seenMs = firstSeen.get(id);
        const when = startedMs
          ? ` · started ${relativeTime(startedMs)}`
          : seenMs
            ? ` · seen ${relativeTime(seenMs)}`
            : "";
        return (
          <Row
            key={id}
            color={SEVERITY_COLOR[a.severity]}
            title={a.firing}
            advice={a.advice}
            meta={`${deviceLabel(a.source)} · ${SEVERITY_LABEL[a.severity]}${when}`}
          />
        );
      })}
    </>
  );
}

function HistoryTab({
  history,
  collectorUp,
}: {
  history: AlertHistoryEntry[];
  collectorUp: boolean | null;
}) {
  // History is what is over. An episode that is still open is the live state —
  // it belongs in Active, and showing it here too would list the same alert
  // twice at once. Only cleared episodes are history, newest first.
  const past = history.filter((e) => e.endMs !== null);
  if (collectorUp === false)
    return (
      <EmptyState className='px-4 py-8'>History unavailable — the recorder isn’t running. Live alerts are unaffected.</EmptyState>
    );
  if (past.length === 0) return <EmptyState className='px-4 py-8'>No alerts cleared in the last 30 days.</EmptyState>;
  return (
    <>
      {past.map((e) => (
        <Row
          key={`${e.source}:${e.key}:${e.startMs}`}
          color={SEVERITY_COLOR[e.severity]}
          dim
          title={e.label}
          meta={`${deviceLabel(e.source)} · lasted ${formatSpan(e.startMs, e.endMs!)} · cleared ${relativeTime(e.endMs!)}`}
        />
      ))}
    </>
  );
}

/** The full green/red health list, grouped by device, problems first. A compact
 *  single-line row per check: small dot, hairline separators, sticky headers. */
function StatusTab({
  statusList,
  dishReachable,
  routerReachable,
}: {
  statusList: AlertState[];
  dishReachable: boolean;
  routerReachable: boolean | null;
}) {
  const groups: { source: AlertSource; label: string; live: boolean }[] = [
    { source: "dish", label: "Dish", live: dishReachable },
    { source: "router", label: "Router", live: routerReachable !== false },
  ];
  return (
    <>
      {groups.map(({ source, label, live }) => {
        const checks = statusList
          .filter((a) => a.source === source)
          .sort((a, b) => Number(b.active) - Number(a.active));
        if (checks.length === 0) return null;
        return (
          <div key={source}>
            <p className='sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--page)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]'>
              <span>{label}</span>
              {/* Never let a stale snapshot read as a live all-clear. */}
              {!live && (
                <span className='normal-case tracking-normal'>not answering · last known</span>
              )}
            </p>
            {checks.map((c) => (
              <div
                key={`${c.source}:${c.key}`}
                className='flex items-center gap-2.5 px-4 py-1'
                style={live ? undefined : { opacity: 0.45 }}
              >
                <span
                  className='size-1.5 shrink-0 rounded-full'
                  style={{
                    background: !live
                      ? "var(--ink-muted)"
                      : c.active
                        ? SEVERITY_COLOR[c.severity]
                        : "var(--status-good)",
                  }}
                />
                <span className='truncate text-[14px] text-[var(--ink)]'>
                  {c.active ? c.firing : c.ok}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

type Tab = "active" | "history" | "status";
const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "history", label: "History" },
  { key: "status", label: "Status" },
];

export function AlertsBell({
  alerts,
  notificationsOn,
  onToggleNotifications,
}: {
  alerts: DeviceAlerts;
  notificationsOn: boolean;
  onToggleNotifications: () => void;
}) {
  const [tab, setTab] = useState<Tab>("active");
  const { active, statusList, history, routerReachable, collectorUp, dishReachable, firstSeen } =
    alerts;
  const activeCount = active.length;
  const badgeColor = activeCount > 0 ? SEVERITY_COLOR[active[0].severity] : "var(--ink-muted)";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className='theme-toggle relative'
          aria-label='Alerts and notifications'
          title={
            activeCount > 0
              ? `${activeCount} active alert${activeCount === 1 ? "" : "s"}`
              : "Alerts — all healthy"
          }
          style={activeCount > 0 ? { color: badgeColor } : undefined}
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' />
            <path d='M13.7 21a2 2 0 0 1-3.4 0' />
          </svg>
          {activeCount > 0 && (
            <span
              className='absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-solid border-[var(--page)] px-1 text-[10px] font-bold leading-none text-white'
              style={{ background: badgeColor }}
            >
              {activeCount}
            </span>
          )}
        </button>
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
          {TABS.map(({ key, label }) => (
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
          {tab === "active" && (
            <ActiveTab active={active} history={history} firstSeen={firstSeen} />
          )}
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
