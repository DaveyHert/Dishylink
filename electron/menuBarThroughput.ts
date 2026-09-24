// Formatting for the two throughput readouts — the macOS menu-bar tray title and
// the Windows floating widget — kept apart from main.ts so it can be tested without
// pulling in Electron. Pure functions, no app state. (The Windows widget's window —
// its placement, dragging, and remembered position — lives in throughputWidget.ts.)

export type ThroughputUnit = "bits" | "bytes";

/**
 * Compact rate for the narrow menu bar: "1.2Mb/s", "340Kb/s", "2.0Gb/s" — or,
 * in bytes, "1.2MB/s", "340KB/s", "2.0GB/s".
 *
 * The thresholds are the SI boundaries the dashboard's formatter uses too
 * (src/lib/format.ts: K below 1e6, M below 1e9, G above), applied after the
 * bits-to-bytes division so a byte readout steps up at 1 MB/s, not at 1 Mb/s.
 * The unit is spelled out as "b/s" or "B/s" so the menu bar reads as a rate on
 * its own, where the dashboard's tile has a "Download"/"Upload" label beside it.
 * Input is always bits per second — the unit the dish reports.
 */
export function formatMenuBarRate(bitsPerSecond: number, unit: ThroughputUnit = "bits"): string {
  const bytes = unit === "bytes";
  const perSecond = bytes ? bitsPerSecond / 8 : bitsPerSecond;
  const suffix = bytes ? "B/s" : "b/s";
  if (perSecond >= 1e9) return `${(perSecond / 1e9).toFixed(1)}G${suffix}`;
  if (perSecond >= 1e6) return `${(perSecond / 1e6).toFixed(1)}M${suffix}`;
  return `${Math.round(perSecond / 1e3)}K${suffix}`;
}

/**
 * The same rate with a space before the unit — "1.2 Mb/s" — for a readout with
 * width to spare. formatMenuBarRate is the packed spelling for a width-constrained
 * surface; this loosens it, so both share one set of thresholds and one unit.
 */
export function formatSpacedRate(bitsPerSecond: number, unit: ThroughputUnit = "bits"): string {
  return formatMenuBarRate(bitsPerSecond, unit).replace(/(?=[KMG][bB]\/s$)/, " ");
}
