// The three panes of the alerts menu. They answer different questions and are
// deliberately kept from speaking for each other: Active is what is firing now,
// History is what is over, Status is what every check currently says.

import type { AlertHistoryEntry, DeviceAlerts } from "../../hooks/useDeviceAlerts";
import type { AlertSource, AlertState } from "@core/alertDefinitions";
import { EmptyState } from "../ui/empty-state";
import { AlertRow } from "./AlertRow";
import {
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  deviceLabel,
  formatSpan,
  relativeTime,
} from "./alertFormat";

export function ActiveTab({
  active,
  history,
  firstSeen,
}: {
  active: AlertState[];
  history: AlertHistoryEntry[];
  firstSeen: Map<string, number>;
}) {
  // Live alerts are bare booleans — the device sends no timestamp. The real
  // onset lives in the historian's still-open episode ("started 2h ago"); with
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
          <AlertRow
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

export function HistoryTab({
  history,
  historianUp,
}: {
  history: AlertHistoryEntry[];
  historianUp: boolean | null;
}) {
  // History is what is over. An episode that is still open is the live state —
  // it belongs in Active, and showing it here too would list the same alert
  // twice at once. Only cleared episodes are history, newest first.
  const past = history.filter((e) => e.endMs !== null);
  if (historianUp === false)
    return (
      <EmptyState className='px-4 py-8'>
        History unavailable — the recorder isn’t running. Live alerts are unaffected.
      </EmptyState>
    );
  if (past.length === 0)
    return <EmptyState className='px-4 py-8'>No alerts cleared in the last 30 days.</EmptyState>;
  return (
    <>
      {past.map((e) => (
        <AlertRow
          key={`${e.source}:${e.key}:${e.startMs}`}
          color={SEVERITY_COLOR[e.severity]}
          title={e.label}
          meta={`${deviceLabel(e.source)} · lasted ${formatSpan(e.startMs, e.endMs!)} · cleared ${relativeTime(e.endMs!)}`}
        />
      ))}
    </>
  );
}

/** The full green/red health list, grouped by device, problems first. A compact
 *  single-line row per check: small dot, hairline separators, sticky headers. */
export function StatusTab({
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
            <p className='sticky top-0 z-10 flex items-center justify-between gap-2 bg-page px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted'>
              <span>{label}</span>
              {/* Never let a stale snapshot read as a live all-clear. */}
              {!live && (
                <span className='normal-case tracking-normal'>
                  Starlink offline · last known status
                </span>
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
                <span className='truncate text-[14px] text-ink'>{c.active ? c.firing : c.ok}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Props the menu threads straight through to whichever pane is open. */
export type AlertsTabData = Pick<
  DeviceAlerts,
  | "active"
  | "history"
  | "statusList"
  | "firstSeen"
  | "historianUp"
  | "dishReachable"
  | "routerReachable"
>;
