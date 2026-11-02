// Outage/event history from the historian's durable log.
//
// The dish's own event list is short and rolls, and it resets on reboot, so the
// live decode in useDishTelemetry only ever shows what the dish still happens to
// remember. The historian records each poll's view, so this reaches back weeks —
// but only over the time the historian has been running.

import { canonicalCause, type OutageEvent } from "@core/telemetry";
import { usePolledEndpoint } from "./usePolledEndpoint";

/** Same outage from two sources: the dish restates it as its duration grows. Keyed
 *  on the canonical cause token so the live decode and a differently-labelled
 *  persisted copy of the same event fold together instead of showing twice. */
function keyOf(event: OutageEvent): string {
  return `${event.startMs}:${canonicalCause(event.cause)}`;
}

/**
 * Live and persisted views of the same event list, folded into one. Keeps the
 * longer duration for any outage both sources know about — the dish restates an
 * in-progress outage as it runs on.
 */
export function mergeOutages(live: OutageEvent[], persisted: OutageEvent[]): OutageEvent[] {
  const byKey = new Map<string, OutageEvent>();
  for (const event of [...persisted, ...live]) {
    const existing = byKey.get(keyOf(event));
    if (!existing || event.durationMs > existing.durationMs) byKey.set(keyOf(event), event);
  }
  return [...byKey.values()];
}

const NO_EVENTS: OutageEvent[] = [];

function pickEvents(body: unknown): OutageEvent[] {
  return (body as { events?: OutageEvent[] }).events ?? NO_EVENTS;
}

export function useOutageHistory(): OutageEvent[] {
  return usePolledEndpoint("/api/outages", pickEvents, NO_EVENTS);
}
