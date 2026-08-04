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
  /** The router's own ping to the PoP — a second opinion on the same round trip.
   *  The router keeps no ring buffer for it (its history RPC is
   *  permission-denied), so unlike every other field here this one is not
   *  decoded from a replayable buffer: it is sampled and stamped on, by the
   *  historian for persisted history and by the browser for the live edge.
   *  Null wherever nothing was sampling — never a stale value carried forward. */
  routerLatencyMs: number | null;
  /** Router → PoP ping success (0–100), from get_status's popPingDropRate5m —
   *  the router's own rolling five-minute measure, riding a reply already
   *  fetched. NEVER sourced from get_ping (1009), which reboots the router.
   *  Stamped the same way and for the same reason as routerLatencyMs. */
  routerPingSuccessPercent: number | null;
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

/**
 * What actually happened, as opposed to what raised it. Both devices write to
 * one event log and most of what lands there is not an outage: the router logs
 * a failed keepalive ping the same way the dish logs a total loss of service.
 * Banding all of it red told the reader the internet was down while their own
 * throughput chart, directly above, showed traffic still flowing.
 *
 * So the kind is what surfaces read, never the duration or the severity:
 *  - `outage`   — service was down. The only kind that earns a red band.
 *  - `degraded` — a link was impaired while traffic kept flowing (a keepalive
 *                 ping going unanswered, elevated packet loss). Worth logging,
 *                 never worth claiming an outage for.
 *  - `info`     — notable but nothing was wrong (a device changing Wi-Fi band).
 */
export type EventKind = "outage" | "degraded" | "info";

export interface OutageMeta {
  /** Row title. */
  label: string;
  /** Plain-English "what this was", shown in the row's info dot. */
  tip?: string;
  /** What happened, decided here so no surface has to infer it from a token. */
  kind: EventKind;
}

// Canonical token → how the event is shown. Distinct per cause (not collapsed):
// each keeps its own meaning, with the raw dish jargon explained in `tip`.
const OUTAGE_META: Record<string, OutageMeta> = {
  NO_PINGS: {
    label: "Ping Network Interruption",
    tip: "Radio frequency link looked fine but pings to the ground station/POP failed — traffic wasn't actually flowing.",
    kind: "outage",
  },
  NO_DOWNLINK: {
    label: "Downlink Network Interruption",
    tip: "Dish was pointed at a satellite but received no decodable downlink signal.",
    kind: "outage",
  },
  NO_SATS: {
    label: "No satellite in range",
    tip: "No Starlink satellite was overhead to connect to.",
    kind: "outage",
  },
  NO_SCHEDULE: {
    label: "No service scheduled",
    tip: "Network gave your cell no time slot (seen during network congestion, service issues, account problems, or right after boot before a schedule downloads).",
    kind: "outage",
  },
  UNKNOWN: {
    label: "Unknown Event",
    tip: "Dish couldn't classify the drop.",
    kind: "outage",
  },
  OBSTRUCTED: {
    label: "Dish's view obstructed",
    tip: "Something physically blocked the dish's view of the sky (branch, roof, pole), so it dropped the satellite.",
    kind: "outage",
  },
  THERMAL_SHUTDOWN: {
    label: "Overheated",
    tip: "The dish's internal temperature exceeded safe limits (hot climate + direct sun) and it shut down to cool off.",
    kind: "outage",
  },
  RAIN_SNR_PERSISTENTLY_LOW: {
    label: "Weather interference",
    tip: "Heavy rain/snow degraded signal-to-noise below usable level.",
    kind: "outage",
  },
  // A prior build persisted this label before we stored raw enums; keep it as an
  // alias so those rows still resolve to the same meaning and dedupe.
  WEAK_SIGNAL_FROM_WEATHER: {
    label: "Weather interference",
    tip: "Heavy rain/snow degraded signal-to-noise below usable level.",
    kind: "outage",
  },
  BOOTING: {
    label: "Starlink booting",
    tip: "Dish was rebooting / powering up.",
    kind: "outage",
  },
  SKY_SEARCH: {
    label: "Searching for satellites",
    tip: "Dish was scanning the sky to lock onto satellites (after boot or being moved).",
    kind: "outage",
  },
  ACTUATOR_ACTIVITY: {
    label: "Repositioning",
    tip: "The dish's motors were physically moving it (repositioning/realigning); RF is muted while it moves.",
    kind: "outage",
  },
  STOWED: {
    label: "Dish stowed",
    tip: "Dish was folded in stow position.",
    kind: "outage",
  },
  SLEEPING: {
    label: "Scheduled sleep",
    tip: 'Scheduled sleep window (the "snooze" schedule in the app).',
    kind: "outage",
  },
  CABLE_TEST: {
    label: "Cable test",
    tip: "Dish was running its cable diagnostic.",
    kind: "outage",
  },
  INHIBIT_RF: {
    label: "Transmission paused",
    tip: "Dish stopped transmitting (RF inhibited — for safety, or commanded off).",
    kind: "outage",
  },
  // Router (wifi_get_history) events. The rest of the EventReason set auto-cleans
  // via prettifyToken ("Router software update", "Router reboot", …); only these
  // need bespoke wording.
  ROUTER_POWER_CYCLE: {
    label: "Router powered on",
    tip: "The router lost and regained power (unplugged/replugged, or a power blip).",
    kind: "info",
  },
  CLIENT_SWITCHING_BAND: {
    label: "Device switched WiFi band",
    tip: "A connected device moved between the 2.4 GHz and 5 GHz bands. This is normal when devices are optimizing their connection for best WiFi performance.",
    kind: "info",
  },
  // prettifyToken renders this one as "Eth no link", which explains nothing.
  ETH_NO_LINK: {
    label: "Ethernet cable link to dish disconnected",
    tip: "The ethernet link between the router and the dish went dead. Expected for a few seconds while either device reboots; at any other time, check the cable at both ends.",
    kind: "outage",
  },

  // Router (wifi_get_history) events. The router logs these into the same event
  // log the dish writes outages to, which is why the kind matters more here than
  // anywhere: none of the four below is an outage, and three of them ran for
  // half a minute or more while throughput carried on uninterrupted.
  ROUTER_POP_IPV4_PING_DROP: {
    label: "Router lost its keepalive ping (IPv4)",
    tip: "The router's own ping to the ground station went unanswered. It watches the link with these pings; losing them means the path looked unhealthy to the router, not that your traffic stopped — data usually keeps flowing right through it.",
    kind: "degraded",
  },
  ROUTER_POP_IPV6_PING_DROP: {
    label: "Router lost its keepalive ping (IPv6)",
    tip: "As the IPv4 drop, on the IPv6 path. Seen alone it usually means only IPv6 was affected, which most traffic can route around.",
    kind: "degraded",
  },
  ROUTER_DISH_PING_DROP: {
    label: "Router lost contact with the dish briefly",
    tip: "The router's keepalive ping to the dish over the Ethernet cable went unanswered. Expected while the dish reboots; otherwise it points at the cable between them.",
    kind: "degraded",
  },
  HIGH_DOWNLINK_PACKET_LOSS: {
    label: "High downlink packet loss",
    tip: "A raised share of incoming packets was lost. The connection stayed up — this is quality degrading, not service stopping.",
    kind: "degraded",
  },
  CLIENT_SWITCHING_UPSTREAM_MAC: {
    label: "Device moved to another access point",
    tip: "A connected device handed off between the router and a mesh node, or between radios.",
    kind: "info",
  },
  ROUTER_PUBLIC_IPV4_CHANGE: {
    label: "Public IP address changed",
    tip: "Starlink issued the router a different public IPv4 address — normal on a CGNAT network.",
    kind: "info",
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
  if (!cause) return { label: "Unknown event", kind: "info" };
  const meta = OUTAGE_META[canonicalCause(cause)];
  if (meta) return meta;
  const bare = cause.replace(/^EVENT_REASON_/, "");
  return {
    label: /^[A-Z0-9_]+$/.test(bare) ? prettifyToken(canonicalCause(cause)) : cause,
    // A token no catalogue knows still has to be given a kind, and the firmware
    // namespaces its own: only OUTAGE_* means service stopped. Everything else
    // defaults to `info` rather than `outage` — an unrecognised token painting a
    // red band across the charts is exactly the bug this kind exists to end, and
    // under-claiming a new event is the cheaper mistake. Add it to the catalogue
    // when one shows up (it will read as a bare prettified token until then).
    kind: /^EVENT_REASON_OUTAGE_|^OUTAGE_/.test(cause) ? "outage" : "info",
  };
}

/** Just the title — for notifications and other one-line uses. */
export function outageEventLabel(cause: string): string {
  return outageEventMeta(cause).label;
}

/** What the event was, for surfaces that treat outages differently from the
 *  link and informational events sharing the same log. */
export function outageEventKind(cause: string): EventKind {
  return outageEventMeta(cause).kind;
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
      routerLatencyMs: null,
      routerPingSuccessPercent: null,
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
 *  typed decoded JSON the historian hands over. */
export function decodeWifiHistoryEvents(wifiHistory: {
  eventLog?: { events?: unknown[] };
}): OutageEvent[] {
  return decodeEventLog((wifiHistory.eventLog?.events ?? []) as DishEventJson[]);
}

/** Readings the router reports live, which no ring buffer can replay. */
export interface RouterReadings {
  latencyMs?: number | null;
  pingSuccessPercent?: number | null;
}

/**
 * A latency reading only if it is one. proto3 omits a zero and toJson renders
 * NaN as the string "NaN"; neither is a measurement. One guard shared by every
 * consumer of `popPingLatencyMs` — the historian and the browser must agree on
 * what counts as a reading, or the persisted series and the live edge diverge.
 */
/**
 * How many consecutive fully-dropping samples make an outage rather than a blip.
 *
 * The dish reports one sample a second and a single dropped second is ordinary —
 * a satellite handover does it. Eight in a row is the link being down, and at the
 * dish's own cadence that is eight seconds, fast enough to be worth interrupting
 * someone for and slow enough not to fire on a handover.
 */
export const OUTAGE_SAMPLE_RUN = 8;

/**
 * Whether the Starlink side is down right now: the dish is answering us, and
 * every recent sample says none of its pings to the point of presence came back.
 *
 * Shared so the recorder and a browser tab call the same thing an outage. Two
 * implementations of "how many dropped seconds is an outage" is how the tray and
 * the panel end up disagreeing about whether the link is down.
 */
export function isStarlinkOutage(samples: readonly { dropRate: number }[]): boolean {
  const recent = samples.slice(-OUTAGE_SAMPLE_RUN);
  if (recent.length < OUTAGE_SAMPLE_RUN) return false;
  return recent.every((sample) => sample.dropRate >= 1);
}

export function readRouterLatencyMs(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Router ping success (0–100) from get_status's `popPingDropRate5M`. Call it
 * only with a reply in hand: absent IS the proto3 zero — no drops, 100% — and
 * only an answering router can assert that. (An unreachable router is the
 * caller's null, not this function's.) toJson renders NaN as a string, and a
 * rate outside 0–1 is not a rate; neither becomes a percentage.
 */
export function readRouterPingSuccessPercent(dropRate5M: number | undefined): number | null {
  if (dropRate5M === undefined) return 100;
  return typeof dropRate5M === "number" &&
    Number.isFinite(dropRate5M) &&
    dropRate5M >= 0 &&
    dropRate5M <= 1
    ? (1 - dropRate5M) * 100
    : null;
}

/** One radio's Wi-Fi temperature and the airtime it is allowed. `temp2` is the
 *  only populated sensor on current firmware; `dutyCycle` falls as the chip is
 *  cooled, so a rising temp beside a falling duty cycle is heat throttling. */
export interface RadioStatReading {
  band: string;
  tempC: number;
  dutyCycle: number;
}

/** Decode the router's get_radio_stats reply into per-radio readings, dropping
 *  radios that report no usable temperature. Shape-typed so it needs no import. */
export function decodeRadioReadings(stats: {
  radioStats?: Array<{
    band?: string;
    thermalStatus?: { temp?: number; temp2?: number; dutyCycle?: number };
  }>;
}): RadioStatReading[] {
  const readings: RadioStatReading[] = [];
  for (const radio of stats.radioStats ?? []) {
    const tempC = radio.thermalStatus?.temp2 ?? radio.thermalStatus?.temp;
    if (tempC === undefined || !Number.isFinite(tempC)) continue;
    readings.push({
      band: radio.band ?? "unknown",
      tempC,
      dutyCycle: radio.thermalStatus?.dutyCycle ?? 100,
    });
  }
  return readings;
}

/**
 * A position in the dish's since-boot sample counter — how far a consumer has
 * already read the ring buffer. Small and copyable so it can be held in memory
 * by a long-lived loop or persisted by one that is torn down between polls.
 */
export interface SampleCursor {
  /** Absolute count of samples the dish had written the last time we read. 0
   *  means "unknown" — nothing read yet, or a buffer seeded without one. */
  counter: number;
  /** Timestamp (ms) of the newest sample already taken. The fallback dedup key
   *  for when the counter cannot be trusted. */
  newestSampleMs: number;
}

/**
 * The samples in this poll's window that have not been recorded yet.
 *
 * Consecutive polls re-read the dish's 15-minute ring buffer, so all but the
 * newest few seconds overlap what the previous poll already saw. This is the one
 * place that decides which samples are genuinely new, so the record neither
 * stores a sample twice nor skips one.
 *
 * Pure — no state, no side effects — so a long-lived loop and an alarm that
 * re-reads the same window (the extension, which keeps no persistent process)
 * share a single definition of "new".
 *
 * New is judged by the dish's since-boot sample counter when it can be trusted,
 * and by timestamp when it cannot: a reboot restarts the counter, and a buffer
 * just restored from a snapshot has no counter yet. Both untrusted cases take the
 * one timestamp fallback, leaving a single edge to reason about rather than two.
 */
export function selectFreshSamples(
  window: { samples: TelemetrySample[]; newestCounter: number },
  cursor: SampleCursor,
): TelemetrySample[] {
  if (window.samples.length === 0) return [];
  const counterTrustworthy = cursor.counter > 0 && window.newestCounter >= cursor.counter;
  if (!counterTrustworthy) {
    // Nothing recorded yet: the whole window is new.
    if (cursor.newestSampleMs === 0) return window.samples;
    // Otherwise keep only what is newer by clock than the newest sample held. The
    // +500ms absorbs the sub-second jitter in a sample's stamped time across
    // overlapping polls, so a sample already held is never re-appended.
    return window.samples.filter((sample) => sample.timestampMs > cursor.newestSampleMs + 500);
  }
  // A trustworthy counter means exactly the samples past it are new — drain
  // strictly by position, independent of how many the caller currently holds. A
  // persisted-cursor caller with no in-memory buffer (the extension) relies on
  // this: it must get only what advanced past its cursor, never the whole window.
  const freshCount = Math.min(window.newestCounter - cursor.counter, window.samples.length);
  return window.samples.slice(window.samples.length - freshCount);
}

/**
 * Stitches ring-buffer polls into one continuous series holding a fixed span of
 * clock.
 *
 * The span is real time, so a silence occupies room in the buffer: six hours of
 * retention across a five-hour outage holds one hour of readings, and the
 * outage is part of what those six hours have to say. Consumers window by
 * timestamp, and a buffer measured the same way can never hand them more time
 * than they asked for.
 */
export class TelemetryAccumulator {
  private samples: TelemetrySample[] = [];
  private newestCounter = 0;

  constructor(private readonly retentionMs: number) {}

  /** Drop everything older than the retention span, measured back from the
   *  newest sample held. A buffer seeded from a snapshot is entirely in the
   *  past; measured back from Date.now() it would empty itself on restore. */
  private trim(): void {
    if (this.samples.length === 0) return;
    const cutoffMs = this.samples[this.samples.length - 1].timestampMs - this.retentionMs;
    const firstKept = this.samples.findIndex((sample) => sample.timestampMs >= cutoffMs);
    if (firstKept > 0) this.samples = this.samples.slice(firstKept);
  }

  /**
   * Backfill with previously persisted samples (from the historian service or
   * a snapshot file) before live polling starts. No-op once live data exists.
   */
  seed(persistedSamples: TelemetrySample[]): TelemetrySample[] {
    if (this.samples.length === 0 && persistedSamples.length > 0) {
      this.samples = [...persistedSamples];
      this.trim();
    }
    return this.samples;
  }

  /**
   * `router` holds the latest readings taken from the router, stamped onto the
   * samples this poll appends. The router is polled slower than the dish's 1 Hz
   * ring, so one reading lands on the handful of samples it spans — a step-wise
   * series, which is what a point-in-time value honestly is. A field left null
   * stays null on those samples rather than repeating the last known value.
   */
  ingest(
    history: DishHistoryJson,
    nowMs: number,
    router: RouterReadings = {},
    /** Skips the decode below when a caller already has it (avoids re-unrolling
     *  the same ring buffer twice in one poll cycle). */
    precomputedWindow?: ReturnType<typeof decodeHistoryWindow>,
  ): TelemetrySample[] {
    const window = precomputedWindow ?? decodeHistoryWindow(history, nowMs);
    if (window.samples.length === 0) return this.samples;

    // Which samples are new is decided by the shared, pure selectFreshSamples: by
    // counter normally, by timestamp when a reboot has run the counter backwards
    // or a seeded buffer has no counter yet. The buffer holds the user's recorded
    // history and is never discarded across a reboot — only appended to.
    const freshSamples = selectFreshSamples(window, {
      counter: this.newestCounter,
      newestSampleMs: this.samples.length ? this.samples[this.samples.length - 1].timestampMs : 0,
    });
    for (const sample of freshSamples) {
      if (router.latencyMs != null) sample.routerLatencyMs = router.latencyMs;
      if (router.pingSuccessPercent != null) {
        sample.routerPingSuccessPercent = router.pingSuccessPercent;
      }
    }
    this.samples.push(...freshSamples);
    this.newestCounter = window.newestCounter;

    this.trim();
    return this.samples;
  }
}
