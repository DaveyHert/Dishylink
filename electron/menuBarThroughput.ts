// Formatting for the two throughput readouts — the macOS menu-bar tray title and
// the Windows floating widget — kept apart from main.ts so it can be tested without
// pulling in Electron. Pure functions, no app state. (The Windows widget's window —
// its placement, dragging, and remembered position — lives in throughputWidget.ts.)

/**
 * Compact bitrate for the narrow menu bar: "1.2Mb/s", "340Kb/s", "2.0Gb/s".
 *
 * The thresholds are the SI boundaries the dashboard's formatter uses too
 * (src/lib/format.ts: K below 1e6, M below 1e9, G above); the unit is spelled out
 * as "b/s" so the menu bar reads as a rate on its own, where the dashboard's tile
 * has a "Download"/"Upload" label beside it (there it renders "1.2 Mbps"). Input
 * is bits per second — the same unit the dish reports and the dashboard renders.
 */
export function formatMenuBarRate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(1)}Gb/s`;
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(1)}Mb/s`;
  return `${Math.round(bitsPerSecond / 1e3)}Kb/s`;
}

/**
 * The same rate with a space before the unit — "1.2 Mb/s" — for a readout with
 * width to spare. formatMenuBarRate is the packed spelling for a width-constrained
 * surface; this loosens it, so both share one set of thresholds and one unit.
 */
export function formatSpacedRate(bitsPerSecond: number): string {
  return formatMenuBarRate(bitsPerSecond).replace(/(?=[KMG]b\/s$)/, " ");
}
