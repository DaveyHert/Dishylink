import type { EventKind } from "@core/telemetry";

// The same rating the event's detail shows as its Outage / Degraded / Info tag,
// so a row and its detail can never disagree. The device's own severity stamp
// is not used here: the dish stamps its ping and downlink interruptions, where
// service stopped, as warnings.
const KIND_COLOR_VAR: Record<EventKind, string> = {
  outage: "--status-critical",
  degraded: "--chart-warm",
  info: "--ink-muted",
};

/** The coloured dot an event carries in its row. */
export function EventKindMark({ kind }: { kind: EventKind }) {
  return (
    <span
      aria-hidden
      data-kind={kind}
      className='size-[7px] shrink-0 rounded-full'
      style={{ background: `var(${KIND_COLOR_VAR[kind]})` }}
    />
  );
}
