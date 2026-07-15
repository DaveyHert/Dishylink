// Shared display formatting for telemetry values.

export function formatThroughput(bitsPerSecond: number): { value: string; unit: string } {
  if (bitsPerSecond >= 1_000_000_000) return { value: (bitsPerSecond / 1e9).toFixed(2), unit: "Gbps" };
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

export function formatClockTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
