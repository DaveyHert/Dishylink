// Recent outage / event log from the dish's history buffer, newest first.
// Layout mirrors the official app: time on the left, the event, then a tag/
// duration on the right. Each cause carries a plain-English tooltip (the dish's
// raw jargon explained) via outageEventMeta.

import { canonicalCause, outageEventMeta, type OutageEvent } from "@core/telemetry";
import { formatClockTimeShort, formatEventDuration } from "../../lib/format";
import { EmptyState } from "../ui/empty-state";
import { InfoDot } from "../shared/InfoDot";

// Severity, not the event kind. The thermal episodes reach this list with human
// labels and no catalogue entry (useThermalEvents), so a kind lookup returns the
// unknown-token default and paints a thermal shutdown the same grey as a Wi-Fi
// band switch. Severity is carried on every event from every source, including
// those, and is the one field that is always right here.
const SEVERITY_COLOR_VAR: Record<OutageEvent["severity"], string> = {
  advisory: "--ink-muted",
  warning: "--chart-warm",
  critical: "--status-critical",
};

export function OutageLog({ outageEvents }: { outageEvents: OutageEvent[] }) {
  const newestFirst = [...outageEvents].sort((a, b) => b.startMs - a.startMs);
  return (
    <div className='col-span-4 min-w-0 rounded-xl bg-card px-[18px] py-4'>
      <div className='mb-2.5 flex items-center justify-between gap-3'>
        <span className='text-[16px] font-semibold tracking-[0.005em] text-foreground'>
          Events &amp; outages
        </span>
        <span className='text-[12px] font-medium text-muted-foreground'>
          {newestFirst.length} events
        </span>
      </div>
      {newestFirst.length === 0 ? (
        <EmptyState className='py-[18px]'>no outages recorded in the current window</EmptyState>
      ) : (
        <div className='thin-scroll flex max-h-[240px] flex-col overflow-y-auto'>
          {newestFirst.map((outage) => {
            const meta = outageEventMeta(outage.cause);
            return (
              <div
                className='grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b border-border px-0.5 py-2 text-[13px] font-medium last:border-b-0'
                key={`${outage.startMs}-${canonicalCause(outage.cause)}`}
              >
                <span className='font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
                  {formatClockTimeShort(outage.startMs)}
                </span>
                <span className='flex min-w-0 items-center gap-2'>
                  <span
                    className='size-[7px] shrink-0 rounded-full'
                    style={{ background: `var(${SEVERITY_COLOR_VAR[outage.severity]})` }}
                  />
                  <span className='overflow-hidden text-ellipsis whitespace-nowrap text-foreground'>
                    {meta.label}
                  </span>
                  {meta.tip && <InfoDot tip={meta.tip} />}
                </span>
                <span className='font-mono text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums'>
                  {formatEventDuration(outage.durationMs)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
