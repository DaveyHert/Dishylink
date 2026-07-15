// Recent outage / event log from the dish's history buffer, newest first.

import type { OutageEvent } from "../lib/telemetry";
import { formatClockTime, formatDurationMs } from "../lib/format";

const SEVERITY_COLOR_VAR: Record<OutageEvent["severity"], string> = {
  advisory: "--ink-muted",
  warning: "--chart-warm",
  critical: "--status-critical",
};

export function OutageLog({ outageEvents }: { outageEvents: OutageEvent[] }) {
  const newestFirst = [...outageEvents].sort((a, b) => b.startMs - a.startMs);
  return (
    <div className="card span-4">
      <div className="card-header">
        <span className="card-title">Events &amp; outages</span>
        <span className="card-meta">{newestFirst.length} events</span>
      </div>
      {newestFirst.length === 0 ? (
        <div className="empty-note">no outages recorded in the current window</div>
      ) : (
        <div className="outage-list">
          {newestFirst.map((outage, eventIndex) => (
            <div className="outage-row" key={`${outage.startMs}-${eventIndex}`}>
              <span
                className="status-dot"
                style={{ background: `var(${SEVERITY_COLOR_VAR[outage.severity]})` }}
              />
              <span className="outage-cause">{outage.cause}</span>
              <span className="outage-when">
                {formatClockTime(outage.startMs)} · {formatDurationMs(outage.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
