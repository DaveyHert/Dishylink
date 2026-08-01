// Formatting and layout math for the two throughput readouts — the macOS menu-bar
// tray title and the Windows taskbar strip — kept apart from main.ts so it can be
// tested without pulling in Electron. Pure math, no app state; the geometry types
// mirror Electron's Rectangle rather than importing it, so this file stays
// electron-free and importable from a Node test.

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

/** A screen rectangle, matching the shape of Electron's Rectangle. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display's full extent and the part of it not covered by the taskbar. */
export interface DisplayMetrics {
  bounds: Rect;
  workArea: Rect;
}

/**
 * The taskbar strip's default spot: centred in the taskbar band, tucked left of
 * the clock. The band is inferred from the gap between the display's full bounds
 * and its work area — that gap is the taskbar. A bottom bar is the common case; a
 * top bar is handled the same way in the top band. For a side bar, or an
 * auto-hidden one that leaves no gap, there's no horizontal band to ride, so the
 * strip pins to the bottom-right of the usable area instead of landing off-screen.
 */
export function defaultStripPosition(
  display: DisplayMetrics,
  size: { width: number; height: number },
): { x: number; y: number } {
  const { bounds, workArea } = display;
  const bottomBand = bounds.y + bounds.height - (workArea.y + workArea.height);
  const topBand = workArea.y - bounds.y;
  // Left of the clock and system-tray cluster, roughly its width, so the default
  // spot clears it. Only a starting point — the strip is a small, fixed overlay.
  const clockClearance = 180;
  if (bottomBand > 0) {
    return {
      x: bounds.x + bounds.width - size.width - clockClearance,
      y: bounds.y + bounds.height - bottomBand + Math.round((bottomBand - size.height) / 2),
    };
  }
  if (topBand > 0) {
    return {
      x: bounds.x + bounds.width - size.width - clockClearance,
      y: bounds.y + Math.round((topBand - size.height) / 2),
    };
  }
  return {
    x: workArea.x + workArea.width - size.width - 8,
    y: workArea.y + workArea.height - size.height - 8,
  };
}
