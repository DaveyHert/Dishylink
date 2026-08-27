// Shared display formatting for telemetry values.

export function formatThroughput(bitsPerSecond: number): { value: string; unit: string } {
  if (bitsPerSecond >= 1_000_000_000)
    return { value: (bitsPerSecond / 1e9).toFixed(2), unit: "Gbps" };
  if (bitsPerSecond >= 1_000_000) return { value: (bitsPerSecond / 1e6).toFixed(1), unit: "Mbps" };
  return { value: (bitsPerSecond / 1e3).toFixed(0), unit: "kbps" };
}

/** "268 kbps" / "1.5 Mbps" — value and unit as one label (tooltips, averages). */
export function formatThroughputLabel(bitsPerSecond: number): string {
  const throughput = formatThroughput(bitsPerSecond);
  return `${throughput.value} ${throughput.unit}`;
}

/** Compact axis tick: "268k" / "1.5M" / "2G". */
export function formatThroughputTick(bitsPerSecond: number): string {
  const throughput = formatThroughput(bitsPerSecond);
  const compactValue = throughput.value.replace(/\.0$/, "");
  return `${compactValue}${throughput.unit[0] === "k" ? "k" : throughput.unit[0]}`;
}

export function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86_400);
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((uptimeSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${Math.floor(uptimeSeconds % 60)}s`;
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
}

/** Event-log duration the way the official app shows it: whole seconds (no ms),
 *  rounded up so a sub-second blip still reads "1s" rather than "0s".
 *
 *  Point-in-time events have no duration at all — the router logs power cycles
 *  and band switches with `durationNs: 0` — and get an empty string. Rounding
 *  those up to "1s" would state a length the event never had. */
export function formatEventDuration(durationMs: number): string {
  if (durationMs <= 0) return "";
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatClockTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Hour and minute only, no seconds ("5:48 PM"), as the official app shows event times. */
export function formatClockTimeShort(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const datePart = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${datePart} · ${formatClockTimeShort(timestampMs)}`;
}

/** The dish's `hasActuators` enum ("HAS_ACTUATORS_YES"/"_NO") → plain Yes/No.
 *  Anything else — the "_UNKNOWN" default or an absent field — reads as Unknown
 *  rather than a blank, so the row still says something. */
export function formatHasActuators(hasActuators: string | undefined): string {
  if (hasActuators === "HAS_ACTUATORS_YES") return "Yes";
  if (hasActuators === "HAS_ACTUATORS_NO") return "No";
  return "Unknown";
}

function withoutTrailingZeros(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** A gigabyte figure split from the unit it reads best in, for a surface that
 *  renders the number and its unit separately. Rolls to TB past a terabyte, as
 *  the Starlink portal's own usage card does. */
export function formatGigabytes(gigabytes: number): { value: string; unit: "GB" | "TB" } {
  const value =
    gigabytes >= 100
      ? gigabytes.toFixed(0)
      : gigabytes >= 1
        ? withoutTrailingZeros(gigabytes, 1)
        : withoutTrailingZeros(gigabytes, 2);
  if (Number(value) < 1000) return { value, unit: "GB" };
  return { value: withoutTrailingZeros(gigabytes / 1000, 2), unit: "TB" };
}

const BYTE_SCALES = [
  { scale: 1e3, unit: "kB", decimals: 0 },
  { scale: 1e6, unit: "MB", decimals: 1 },
  { scale: 1e9, unit: "GB", decimals: 2 },
] as const;

/** Byte counters → human size. Used for per-device data totals. A figure that
 *  rounds up to a thousand of its unit reads in the next one up, so the largest
 *  each unit ever shows is 999: 999 kB, then 1 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e3) return `${Math.round(bytes)} B`;
  for (const { scale, unit, decimals } of BYTE_SCALES) {
    const rounded = Number((bytes / scale).toFixed(decimals));
    if (rounded < 1000) return `${rounded} ${unit}`;
  }
  return `${withoutTrailingZeros(bytes / 1e12, 2)} TB`;
}

/** Coarse "how long ago" for a past timestamp: "just now", "5 min ago",
 *  "3 hours ago", "2 days ago". For last-seen labels, not precise timing. */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Renders a protobuf enum the way the official Starlink app does: drop the
 * enum's own type prefix and sentence-case the rest, so FILTER_CONVERGED reads
 * "Converged" and ACTUATOR_STATE_TILT reads "Tilt".
 *
 * The app keeps SpaceX's vocabulary on its debug screens rather than inventing
 * friendlier words, and the alignment panel is ported from that screen — so it
 * matches, and no term here is one we made up. Returns null for an absent value
 * so callers decide what silence means; for some fields proto3 omission is a
 * real zero value, for others it is genuinely unknown.
 */
export function formatDeviceEnum(value: string | undefined, typePrefix: string): string | null {
  if (!value) return null;
  const tail = value.startsWith(typePrefix) ? value.slice(typePrefix.length) : value;
  const words = tail.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Attitude filter state — "Converged". Absent is NOT assumed to be the zero
 *  value: firmware that never sends the field would otherwise be reported as
 *  having reset, so an absent state stays unknown. */
export function formatAttitudeState(value: string | undefined): string | null {
  return formatDeviceEnum(value, "FILTER_");
}

/** Motor state — "Idle", "Tilt". Absent IS the zero value here: our dish omits
 *  the field and the official app shows "Idle" for it, which is the mapping
 *  proto3 specifies and the app confirms. */
export function formatActuatorState(value: string | undefined): string {
  return formatDeviceEnum(value, "ACTUATOR_STATE_") ?? "Idle";
}
