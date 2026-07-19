// Decoding of the dish's telemetry ring buffer into an absolute-time series,
// plus an accumulator that stitches successive polls into a longer window
// than the 15 minutes the dish itself retains.

import type { DishHistoryJson, DishOutageJson, DishEventJson } from "./dishClient";

export interface TelemetrySample {
  timestampMs: number;
  latencyMs: number | null;
  dropRate: number;
  downlinkBps: number;
  uplinkBps: number;
  powerW: number;
}

export interface OutageEvent {
  startMs: number;
  durationMs: number;
  cause: string;
  severity: "advisory" | "warning" | "critical";
}

/**
 * The `outages[]` timestamps use the GPS epoch (1980-01-06, no leap seconds);
 * `eventLog` uses the Unix epoch. Offset = Unix seconds at GPS epoch minus
 * the 18 leap seconds accumulated since. Verified against this dish: the same
 * outage appears in both lists exactly this far apart.
 */
const GPS_TO_UNIX_OFFSET_NS = BigInt(315_964_800 - 18) * 1_000_000_000n;

function gpsNsToUnixMs(gpsTimestampNs: string): number {
  return Number((BigInt(gpsTimestampNs) + GPS_TO_UNIX_OFFSET_NS) / 1_000_000n);
}

function unixNsToMs(unixTimestampNs: string): number {
  return Number(BigInt(unixTimestampNs) / 1_000_000n);
}

// Dish event/outage reasons arrive as raw enums (EVENT_REASON_*, DishOutage
// .Cause). We STORE them raw — the enum is the stable identity used for dedup —
// and translate to a human label only at display (outageEventLabel). Keeping
// display text out of the persisted data is what stops a rename from forking one
// event into duplicate rows, and lets the labels match the official app.

/** Reduce a raw enum — or a label a prior build already humanized and persisted —
 *  to one stable token, so the same event dedupes regardless of which spelling
 *  reached us. */
export function canonicalCause(cause: string): string {
  return cause
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^EVENT_REASON_/, "")
    .replace(/^OUTAGE_/, "")
    .replace(/^UT_ALERT_/, "");
}

export interface OutageMeta {
  /** Row title. */
  label: string;
  /** Plain-English "what this was", shown in the row's info dot. */
  tip?: string;
}

// Canonical token → how the event is shown. Distinct per cause (not collapsed):
// each keeps its own meaning, with the raw dish jargon explained in `tip`.
const OUTAGE_META: Record<string, OutageMeta> = {
  NO_PINGS: {
    label: "Ping Network Interruption",
    tip: "Radio frequency link looked fine but pings to the ground station/POP failed — traffic wasn't actually flowing",
  },
  NO_DOWNLINK: {
    label: "Downlink Network Interruption",
    tip: "Dish was pointed at a satellite but received no decodable downlink signal",
  },
  NO_SATS: {
    label: "No satellite in range",
    tip: "No Starlink satellite was overhead to connect to",
  },
  NO_SCHEDULE: {
    label: "No service scheduled",
    tip: "Network gave your cell no time slot (seen during network congestion, service issues, account problems, or right after boot before a schedule downloads)",
  },
  UNKNOWN: {
    label: "Unknown Event",
    tip: "Dish couldn't classify the drop",
  },
  OBSTRUCTED: {
    label: "Dish's view obstructed",
    tip: "Something physically blocked the dish's view of the sky (branch, roof, pole), so it dropped the satellite",
  },
  THERMAL_SHUTDOWN: {
    label: "Overheated",
    tip: "The dish's internal temperature exceeded safe limits (hot climate + direct sun) and it shut down to cool off.",
  },
  RAIN_SNR_PERSISTENTLY_LOW: {
    label: "Weather interference",
    tip: "Heavy rain/snow degraded signal-to-noise below usable level",
  },
  // A prior build persisted this label before we stored raw enums; keep it as an
  // alias so those rows still resolve to the same meaning and dedupe.
  WEAK_SIGNAL_FROM_WEATHER: {
    label: "Weather interference",
    tip: "Heavy rain/snow degraded signal-to-noise below usable level",
  },
  BOOTING: {
    label: "Starlink booting",
    tip: "Dish was rebooting / powering up",
  },
  SKY_SEARCH: {
    label: "Searching for satellites",
    tip: "Dish was scanning the sky to lock onto satellites (after boot or being moved)",
  },
  ACTUATOR_ACTIVITY: {
    label: "Repositioning",
    tip: "The dish's motors were physically moving it (repositioning/realigning); RF is muted while it moves",
  },
  STOWED: {
    label: "Dish stowed",
    tip: "Dish was folded in stow position",
  },
  SLEEPING: {
    label: "Scheduled sleep",
    tip: 'Scheduled sleep window (the "snooze" schedule in the app)',
  },
  CABLE_TEST: {
    label: "Cable test",
    tip: "Dish was running its cable diagnostic",
  },
  INHIBIT_RF: {
    label: "Transmission paused",
    tip: "Dish stopped transmitting (RF inhibited — for safety, or commanded off)",
  },
  // Router (wifi_get_history) events. The rest of the EventReason set auto-cleans
  // via prettifyToken ("Router software update", "Router reboot", …); only these
  // two need bespoke wording.
  ROUTER_POWER_CYCLE: {
    label: "Router powered on",
    tip: "The router lost and regained power (unplugged/replugged, or a power blip)",
  },
  CLIENT_SWITCHING_BAND: {
    label: "Device switching WiFi band",
    tip: "A connected device moved between the 2.4 GHz and 5 GHz bands",
  },
};

/** Sentence-case an unmapped enum token ("SOME_NEW_THING" → "Some new thing"). */
function prettifyToken(token: string): string {
  const words = token
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\bsnr\b/g, "SNR");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Display metadata for an event's cause. Dish enums (raw, or a legacy humanized
 *  string) map to the catalogue; an already-human label (thermal episodes) passes
 *  through as its own title with no tip. */
export function outageEventMeta(cause: string): OutageMeta {
  if (!cause) return { label: "Unknown event" };
  const meta = OUTAGE_META[canonicalCause(cause)];
  if (meta) return meta;
  const bare = cause.replace(/^EVENT_REASON_/, "");
  return { label: /^[A-Z0-9_]+$/.test(bare) ? prettifyToken(canonicalCause(cause)) : cause };
}

/** Just the title — for notifications and other one-line uses. */
export function outageEventLabel(cause: string): string {
  return outageEventMeta(cause).label;
}

/**
 * Unroll the dish's ring buffer. `current` counts samples written since boot;
 * each array holds the last `arrayLength` samples at one sample per second,
 * where absolute sample counter `c` lives at index `c % arrayLength`. The
 * newest sample is pinned to `nowMs`.
 */
export function decodeHistoryWindow(
  history: DishHistoryJson,
  nowMs: number,
): { samples: TelemetrySample[]; newestCounter: number } {
  const newestCounter = Number(history.current ?? 0);
  const latencies = history.popPingLatencyMs ?? [];
  const arrayLength = latencies.length;
  if (arrayLength === 0 || newestCounter === 0) return { samples: [], newestCounter };

  const sampleCount = Math.min(newestCounter, arrayLength);
  const samples: TelemetrySample[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const absoluteCounter = newestCounter - sampleCount + sampleIndex;
    const ringIndex = absoluteCounter % arrayLength;
    const latencyMs = latencies[ringIndex];
    samples.push({
      timestampMs: nowMs - (sampleCount - 1 - sampleIndex) * 1000,
      latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : null,
      dropRate: history.popPingDropRate?.[ringIndex] ?? 0,
      downlinkBps: history.downlinkThroughputBps?.[ringIndex] ?? 0,
      uplinkBps: history.uplinkThroughputBps?.[ringIndex] ?? 0,
      powerW: history.powerIn?.[ringIndex] ?? 0,
    });
  }
  return { samples, newestCounter };
}

// Per-device history is NOT available from the router, despite appearances.
// wifi_get_client_history (3015) returns a ring buffer shaped exactly like the
// dish's — 900 floats, `current` advancing once a second — but this firmware
// never writes throughput into it: every sample reads 0 on every client,
// including one measured pulling 2.2 Mbps at the time. Its rssi,
// throughput_limited and rx_rate_mbps fields are likewise absent.
//
// So the per-device series can only be built by sampling the instantaneous rate
// in wifi_get_clients, which is what useRouterNetwork does. Re-check with
// scripts/probe-client-history.mts after a firmware update before trying again.

/** Decode an EventLog's UXEvent entries. Shared by the dish's dish_get_history
 *  and the router's wifi_get_history — both carry the same UXEvent shape
 *  (Unix-epoch timestamps, an EventReason `reason`, an EventSeverity). Cause is
 *  stored raw; humanized only at display via outageEventMeta. */
function decodeEventLog(events: DishEventJson[]): OutageEvent[] {
  return events.map((event) => ({
    startMs: unixNsToMs(event.startTimestampNs ?? "0"),
    durationMs: Number(BigInt(event.durationNs ?? "0") / 1_000_000n),
    cause: event.reason ?? "",
    severity:
      event.severity === "EVENT_SEVERITY_CRITICAL"
        ? "critical"
        : event.severity === "EVENT_SEVERITY_WARNING"
          ? "warning"
          : "advisory",
  }));
}

export function decodeOutageEvents(history: DishHistoryJson): OutageEvent[] {
  const eventLogEntries = history.eventLog?.events ?? [];
  if (eventLogEntries.length > 0) return decodeEventLog(eventLogEntries);
  return (history.outages ?? []).map((outage: DishOutageJson) => ({
    startMs: gpsNsToUnixMs(outage.startTimestampNs ?? "0"),
    durationMs: Number(BigInt(outage.durationNs ?? "0") / 1_000_000n),
    cause: outage.cause ?? "",
    severity: "warning",
  }));
}

/** Router informational events from wifi_get_history's event log (Router powered
 *  on, device band-switching, reboots, software updates, …). Takes the loosely
 *  typed decoded JSON the collector hands over. */
export function decodeWifiHistoryEvents(wifiHistory: {
  eventLog?: { events?: unknown[] };
}): OutageEvent[] {
  return decodeEventLog((wifiHistory.eventLog?.events ?? []) as DishEventJson[]);
}

/** Stitches ring-buffer polls into one continuous capped series. */
export class TelemetryAccumulator {
  private samples: TelemetrySample[] = [];
  private newestCounter = 0;

  constructor(private readonly maxSamples: number) {}

  /**
   * Backfill with previously persisted samples (from the collector service or
   * a snapshot file) before live polling starts. No-op once live data exists.
   */
  seed(persistedSamples: TelemetrySample[]): TelemetrySample[] {
    if (this.samples.length === 0 && persistedSamples.length > 0) {
      this.samples = persistedSamples.slice(-this.maxSamples);
    }
    return this.samples;
  }

  ingest(history: DishHistoryJson, nowMs: number): TelemetrySample[] {
    const window = decodeHistoryWindow(history, nowMs);
    if (window.samples.length === 0) return this.samples;

    // The dish's sample counter runs backwards on a reboot — and also whenever
    // the link drops long enough for its ring to restart. That only invalidates
    // counter arithmetic; it says nothing about the history we already recorded,
    // which is the user's data. Never discard it: reset the counter and fall
    // through to the wall-clock splice below, which appends only samples newer
    // than what we hold.
    if (window.newestCounter < this.newestCounter) {
      this.newestCounter = 0;
    }

    let freshSamples: TelemetrySample[];
    if (this.newestCounter === 0 && this.samples.length > 0) {
      // First live poll on top of seeded history: the dish ring overlaps the
      // seed's tail, so splice by wall-clock time instead of sample counter.
      const seedNewestMs = this.samples[this.samples.length - 1].timestampMs;
      freshSamples = window.samples.filter((sample) => sample.timestampMs > seedNewestMs + 500);
    } else {
      const freshSampleCount =
        this.newestCounter === 0 || this.samples.length === 0
          ? window.samples.length
          : Math.min(window.newestCounter - this.newestCounter, window.samples.length);
      freshSamples = window.samples.slice(window.samples.length - freshSampleCount);
    }
    this.samples.push(...freshSamples);
    this.newestCounter = window.newestCounter;

    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(this.samples.length - this.maxSamples);
    }
    return this.samples;
  }
}
