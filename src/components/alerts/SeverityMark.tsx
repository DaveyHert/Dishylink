import type { OutageEvent } from "@core/telemetry";

// Severity, not the event kind. The thermal episodes reach the events list with
// human labels and no catalogue entry (useThermalEvents), so a kind lookup
// returns the unknown-token default and paints a thermal shutdown the same grey
// as a Wi-Fi band switch. Severity is carried on every event from every source,
// including those, and is the one field that is always right here.
const SEVERITY_COLOR_VAR: Record<OutageEvent["severity"], string> = {
  advisory: "--ink-muted",
  warning: "--chart-warm",
  critical: "--status-critical",
};

/** The coloured dot an event carries in its row and its detail. */
export function SeverityMark({ severity }: { severity: OutageEvent["severity"] }) {
  return (
    <span
      aria-hidden
      className='size-[7px] shrink-0 rounded-full'
      style={{ background: `var(${SEVERITY_COLOR_VAR[severity]})` }}
    />
  );
}
