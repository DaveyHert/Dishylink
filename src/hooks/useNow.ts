// A ticking wall clock, for surfaces whose window is "the last N minutes from
// now" rather than "the last N minutes of data we hold".
//
// The two only diverge during an outage, which is when it matters. The dish
// stops answering, `samples` stops changing, and poll failures are swallowed
// without setting state (useDishTelemetry — "status polling owns the connection
// indicator"), so nothing triggers a render. Without a clock of its own a
// window would sit still while real time moved, showing a full chart of the
// last good hour. This is what keeps it advancing, so the unmeasured stretch
// grows on screen for as long as the outage lasts.

import { useEffect, useState } from "react";

/** Wall-clock milliseconds, re-rendering the caller every `intervalMs`. */
export function useNow(intervalMs = 1_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timerId);
  }, [intervalMs]);

  return nowMs;
}
