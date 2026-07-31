// Per-device throughput, read from the router's byte counters at the moments the
// router itself updates them.
//
// The router also reports `throughputMbpsLast15sAvg` and
// `throughputMbpsLast1mAvg`, and reading those directly is why the per-device
// chart never matched a speed test: a ~15s transfer at 310 Mbps read as 67 Mbps
// (a 60-second average of a 15-second burst) and then lingered for a minute
// afterwards as the window drained. Those fields exist for callers that cannot
// hold state — a phone app opening a screen, making one call, needing a number.
// We poll from a long-lived process, so we subtract counters instead.
//
// The subtlety is *when* to subtract. `WifiClientStats` carries no timestamp:
// the router hands over a counter and never says when it computed it. Measured
// at 5 Hz, it recomputes each client's counters on a metronome — 23 consecutive
// intervals of 1001-1011 ms. So the counter is not a live value, it is a
// staircase that steps once a second.
//
// Sampling that staircase on our own clock aliases. A poller at 1 Hz drifts
// against a 1005 ms step and periodically lands twice inside one step and not at
// all inside the next: one reading shows almost no bytes moved, the next shows
// double. Nothing is lost, but mid-transfer it renders as a dropout to near zero
// followed by a spike.
//
// Widening the measurement window to span the pair would cancel the artefact by
// averaging it back together, at the cost of the per-second detail the window
// exists to show — and the premise is false: the router is not irregular, only
// unsynchronised sampling is. So instead we poll several times per step and
// detect the *edge*. Each observed change is one refresh interval of traffic,
// whenever it happens to land, and the rate is exact without any smoothing at
// all.

export interface ByteCounters {
  rxBytes: number;
  txBytes: number;
}

export interface ThroughputRates {
  downMbps: number;
  upMbps: number;
}

/**
 * How often the router recomputes a client's counters.
 *
 * Measured on Gen 3 firmware 2026.07.01 at 5 Hz across several clients: median
 * 1005 ms, min 1001, max 1011. This is the denominator rather than the observed
 * poll-to-poll gap deliberately — the delta is one refresh interval of traffic
 * that the *router* accumulated over its own period, so dividing by that period
 * recovers the exact rate, while dividing by our measured gap would inject a
 * poll interval's worth of jitter into a number that has none.
 */
const REFRESH_PERIOD_MS = 1_005;

/**
 * A counter that has stood still this long means the device is genuinely idle,
 * not that we are between edges. Two periods, so a single late refresh does not
 * blink the series to zero mid-transfer.
 *
 * Idle has to be reported rather than merely not-updated: a device that stops
 * sending would otherwise hold its last rate on the chart indefinitely.
 */
const IDLE_AFTER_MS = 2 * REFRESH_PERIOD_MS;

/**
 * Longest gap in *our own polling* still treated as measurable. Beyond this — a
 * slept laptop, a restarted historian — the delta spans a stretch we did not
 * observe, and presenting it as a moment's throughput would invent a plateau
 * that never happened.
 */
const MAX_POLL_GAP_MS = 15_000;

interface DeviceState {
  rxBytes: number;
  txBytes: number;
  /** When we last successfully read this device, edge or not. */
  lastPollAtMs: number;
  /** When the counter last actually moved. */
  lastChangeAtMs: number;
  /** Last exactly-measured rate, held between edges. */
  latest: ThroughputRates | null;
}

function toMbps(bytesDelta: number, elapsedMs: number): number {
  return (bytesDelta * 8) / 1_000_000 / (elapsedMs / 1000);
}

export class ThroughputTracker {
  private devices = new Map<string, DeviceState>();

  /**
   * Record one reading and return the device's current rate. Call on every poll
   * — several times per refresh period — since it is the polls that land between
   * edges which locate them.
   *
   * Falls back to the router's own averages when a delta would lie:
   *   • the first reading, with nothing to subtract from
   *   • the counter went backwards, which the router does per association, so a
   *     device that dropped and rejoined looks like negative traffic
   *   • our polling gapped for longer than any one interval can describe
   *
   * `counters` absent is defensive: measured over 90 polls under load the
   * counter was never missing, but a firmware that omits it must not turn
   * `Number(undefined)` into a NaN rate.
   */
  rates(
    macAddress: string,
    counters: ByteCounters | undefined,
    atMs: number,
    fallback: ThroughputRates,
  ): ThroughputRates {
    if (!counters) return fallback;

    const previous = this.devices.get(macAddress);
    if (!previous) {
      this.seed(macAddress, counters, atMs);
      return fallback;
    }

    // Backwards means the association restarted; the previous session's total
    // is not something this one can be measured against.
    if (counters.rxBytes < previous.rxBytes || counters.txBytes < previous.txBytes) {
      this.seed(macAddress, counters, atMs);
      return fallback;
    }

    const pollGapMs = atMs - previous.lastPollAtMs;
    if (pollGapMs > MAX_POLL_GAP_MS) {
      this.seed(macAddress, counters, atMs);
      return fallback;
    }

    const changed = counters.rxBytes !== previous.rxBytes || counters.txBytes !== previous.txBytes;
    if (changed) {
      // Polling faster than the refresh, every edge is caught as it happens, so
      // a change is one interval — `intervals` only exceeds 1 when our own
      // polling stalled long enough to miss some, which is the sole case a
      // delta legitimately spans more than one step. It must never be derived
      // from the time since the last *change*: a device idle for eight seconds
      // and then bursting would divide that burst by nine and report an eighth
      // of the real rate.
      const intervals = Math.max(1, Math.round(pollGapMs / REFRESH_PERIOD_MS));
      const elapsedMs = intervals * REFRESH_PERIOD_MS;
      previous.latest = {
        downMbps: toMbps(counters.rxBytes - previous.rxBytes, elapsedMs),
        upMbps: toMbps(counters.txBytes - previous.txBytes, elapsedMs),
      };
      previous.lastChangeAtMs = atMs;
    } else if (atMs - previous.lastChangeAtMs >= IDLE_AFTER_MS) {
      previous.latest = { downMbps: 0, upMbps: 0 };
    }

    previous.rxBytes = counters.rxBytes;
    previous.txBytes = counters.txBytes;
    previous.lastPollAtMs = atMs;
    return previous.latest ?? fallback;
  }

  private seed(macAddress: string, counters: ByteCounters, atMs: number): void {
    this.devices.set(macAddress, {
      rxBytes: counters.rxBytes,
      txBytes: counters.txBytes,
      lastPollAtMs: atMs,
      lastChangeAtMs: atMs,
      latest: null,
    });
  }

  /** Drop state for devices no longer present, so the map cannot grow forever. */
  retain(macAddresses: Iterable<string>): void {
    const live = new Set(macAddresses);
    for (const macAddress of this.devices.keys()) {
      if (!live.has(macAddress)) this.devices.delete(macAddress);
    }
  }
}

/**
 * The interval each rate is measured over — the router's refresh period, not a
 * smoothing window, because there is no smoothing. Exported so a caller can say
 * what the number means.
 */
export const RATE_WINDOW_MS = REFRESH_PERIOD_MS;
