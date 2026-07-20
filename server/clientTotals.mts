// Persistent per-device data-usage odometer, bucketed by billing month.
//
// The router serves only `rxStats.bytes` / `txStats.bytes` per client, and those
// reset to zero on every Wi-Fi re-association — a roaming or sleeping laptop
// restarts them several times an hour, so they never reflect what the device has
// actually used. The router keeps no per-device history either (its
// wifi_get_client_history ring returns all zeros on this firmware), so nothing
// upstream can be asked for a real total.
//
// This is what a real traffic monitor (nlbwmon, ntopng) does instead: read the
// counters every poll and accumulate them, treating a counter that went
// backwards as a reset rather than negative traffic. The sum is authoritative
// bytes — not an integral of sampled rates — and, persisted to disk, it survives
// reconnects and restarts.
//
// Totals are a per-device *monthly* figure, the way a data-capped user thinks
// about usage and the way Starlink bills. The month clears lazily: a device is
// re-baselined to zero the first time it is seen in a new calendar month, not on
// a stroke-of-midnight sweep, so an idle device keeps showing last month's total
// with its last-seen time (as the iOS hotspot list does) instead of blinking to
// zero for everyone at once. A device unseen since before last month is dropped,
// so the record stays for at least a month but the list cannot grow forever.
//
// What it cannot do: recover traffic from before it started watching, or across
// a collector outage. The collector seeds the opening value once from the
// per-minute history it already holds, so day one is not zero; anything older
// than that history is genuinely gone.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClientTotal {
  macAddress: string;
  name?: string;
  /** Authoritative cumulative bytes this billing month, across every reconnect. */
  rxBytes: number;
  txBytes: number;
  /** Start of the month these totals cover (local), epoch ms. */
  sinceMs: number;
  /** Last time the device was observed active, epoch ms. */
  lastSeenMs: number;
}

interface TotalState extends ClientTotal {
  /** Which month the totals belong to, as `year * 12 + month` (local). */
  periodMonth: number;
  /** Last counter value observed, to delta against the next one. */
  prevRx: number;
  prevTx: number;
  /** When we last observed it, to tell a live gap from a resumed one. 0 until the
   *  first real reading, so a seeded-but-unseen device is not deltaed from zero. */
  lastPollMs: number;
}

/**
 * A poll gap wider than this means we stopped watching (a restart, a paused
 * laptop): the delta across it would span traffic we did not measure, so we
 * re-baseline instead of counting it. Matches the throughput tracker's ceiling.
 */
const MAX_GAP_MS = 15_000;

/** Local `year * 12 + month` — the bucket a timestamp's usage belongs to. */
function monthOf(atMs: number): number {
  const date = new Date(atMs);
  return date.getFullYear() * 12 + date.getMonth();
}

/** Local midnight on the first of `atMs`'s month, epoch ms. */
function monthStartMs(atMs: number): number {
  const date = new Date(atMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

/** Local midnight on the first of the month *before* `atMs`'s, epoch ms. */
function previousMonthStartMs(atMs: number): number {
  const date = new Date(monthStartMs(atMs));
  date.setMonth(date.getMonth() - 1);
  return date.getTime();
}

export class ClientTotalsStore {
  private states = new Map<string, TotalState>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.restore();
  }

  /** Whether a device already has an entry — the collector checks this before
   *  seeding, so a restart never re-seeds over an accumulated total. */
  has(macAddress: string): boolean {
    return this.states.has(macAddress);
  }

  /**
   * Establish a device's opening total for the current month from history the
   * collector already holds, before the first live counter is observed. No-op if
   * it already has state, so it can be called unconditionally at startup without
   * ever double-counting.
   */
  seed(macAddress: string, rxBytes: number, txBytes: number, atMs: number, name?: string): void {
    if (this.states.has(macAddress)) return;
    this.states.set(macAddress, {
      macAddress,
      name,
      rxBytes,
      txBytes,
      sinceMs: monthStartMs(atMs),
      lastSeenMs: atMs,
      periodMonth: monthOf(atMs),
      prevRx: 0,
      prevTx: 0,
      lastPollMs: 0,
    });
  }

  /**
   * Fold one counter reading into the running total.
   *
   * The delta is `counter - prev` normally; on a counter that went backwards —
   * the router restarting it on re-association — the new value *is* the traffic
   * since the reset, so it is added whole. A first sighting, a gap too wide to
   * measure across, or the first reading of a new month only re-baselines `prev`
   * and adds nothing.
   */
  observe(macAddress: string, rxBytes: number, txBytes: number, atMs: number, name?: string): void {
    const state = this.states.get(macAddress);
    if (!state) {
      this.states.set(macAddress, {
        macAddress,
        name,
        rxBytes: 0,
        txBytes: 0,
        sinceMs: monthStartMs(atMs),
        lastSeenMs: atMs,
        periodMonth: monthOf(atMs),
        prevRx: rxBytes,
        prevTx: txBytes,
        lastPollMs: atMs,
      });
      return;
    }

    const month = monthOf(atMs);
    const rolledOver = month !== state.periodMonth;
    if (rolledOver) {
      // First sighting in a new month: start its bucket fresh. The delta that
      // straddles the boundary is dropped rather than split — one interval.
      state.rxBytes = 0;
      state.txBytes = 0;
      state.periodMonth = month;
      state.sinceMs = monthStartMs(atMs);
    } else {
      const measurable = state.lastPollMs !== 0 && atMs - state.lastPollMs <= MAX_GAP_MS;
      if (measurable) {
        state.rxBytes += rxBytes >= state.prevRx ? rxBytes - state.prevRx : rxBytes;
        state.txBytes += txBytes >= state.prevTx ? txBytes - state.prevTx : txBytes;
      }
    }
    state.prevRx = rxBytes;
    state.prevTx = txBytes;
    state.lastPollMs = atMs;
    state.lastSeenMs = atMs;
    if (name) state.name = name;
  }

  /** Zero one device's total but keep the entry, so it stays listed and keeps
   *  counting forward from now. `prev` is left as-is, so the next reading is a
   *  normal delta against the current counter rather than a jump. Returns whether
   *  the device existed. */
  reset(macAddress: string, atMs: number): boolean {
    const state = this.states.get(macAddress);
    if (!state) return false;
    state.rxBytes = 0;
    state.txBytes = 0;
    state.sinceMs = atMs;
    return true;
  }

  /** Delete one device's record entirely — not a counter reset. The device drops
   *  off the list; if it is still active the collector re-creates a fresh entry on
   *  the next poll, but an offline device stays gone. Returns whether anything was
   *  removed. */
  remove(macAddress: string): boolean {
    return this.states.delete(macAddress);
  }

  /** Delete every record. */
  clear(): void {
    this.states.clear();
  }

  /** Drop devices unseen since before last month so the list cannot grow forever.
   *  Month-aligned rather than a day count: a device seen anywhere in the previous
   *  calendar month survives through this one, which is the "at least a month"
   *  the record is meant to keep. Returns how many were dropped. */
  compact(nowMs: number): number {
    const cutoff = previousMonthStartMs(nowMs);
    let dropped = 0;
    for (const [mac, state] of this.states) {
      if (state.lastSeenMs < cutoff) {
        this.states.delete(mac);
        dropped++;
      }
    }
    return dropped;
  }

  /** Public totals, one device or all (newest activity first). Internal counters
   *  (`prev*`, `lastPollMs`, `periodMonth`) are stripped. */
  totals(macAddress?: string): ClientTotal[] {
    const strip = (s: TotalState): ClientTotal => ({
      macAddress: s.macAddress,
      name: s.name,
      rxBytes: s.rxBytes,
      txBytes: s.txBytes,
      sinceMs: s.sinceMs,
      lastSeenMs: s.lastSeenMs,
    });
    if (macAddress) {
      const state = this.states.get(macAddress);
      return state ? [strip(state)] : [];
    }
    return [...this.states.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs).map(strip);
  }

  private restore(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const persisted = JSON.parse(readFileSync(this.filePath, "utf8")) as TotalState[];
      for (const state of persisted) this.states.set(state.macAddress, state);
    } catch {
      // unreadable snapshot: start fresh rather than refuse to boot
    }
  }

  /** Persist so a restart resumes the running totals rather than seeding anew. */
  snapshot(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify([...this.states.values()]));
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed snapshot costs at most the interval's accumulation on a restart
    }
  }
}
