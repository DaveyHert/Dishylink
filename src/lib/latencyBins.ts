// Binning latency samples into the distribution the Latency screen draws:
// 2 ms bins from 0–100 ms plus one overflow bar, each held as a share of the
// samples rather than a count, so panels on different sample counts compare.

const BIN_MS = 2;
const MAX_MS = 100;
/** 50 real bins plus the ≥100 ms overflow bar, matching the app's axis. */
export const BIN_COUNT = MAX_MS / BIN_MS + 1;

/** Percent of samples per bin. Empty input stays all-zero rather than NaN. */
export function binLatencies(values: number[]): number[] {
  const bins = new Array<number>(BIN_COUNT).fill(0);
  if (values.length === 0) return bins;
  for (const value of values) {
    bins[Math.min(Math.floor(value / BIN_MS), BIN_COUNT - 1)] += 1;
  }
  return bins.map((count) => (count / values.length) * 100);
}
