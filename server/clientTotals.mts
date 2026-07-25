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
// Deltas are computed per roster *entry*, totals per MAC. The distinction only
// matters when they differ: two devices sharing a cloned MAC (both Govee
// lights, found 2026-07-21) appear as two roster entries, and deltaing across
// their interleaved counters read every flip as a reset — phantom gigabytes.
// Each entry deltas against itself; the MAC's total is the sum of its entries'
// deltas, so usage stays keyed by MAC exactly as before.
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
// a historian outage. The historian seeds the opening value once from the
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
}

/**
 * The last counter reading from ONE router roster entry — the unit a delta is
 * coherent within. A MAC is not that unit: two devices can share a cloned MAC
 * (two Govee lights, observed 2026-07-21) and the router lists both, so their
 * counters must never be deltaed against each other. Deltas are computed here,
 * per entry, and only the resulting deltas accumulate into the per-MAC total.
 */
interface EntryCounter {
  /** Last counter value observed, to delta against the next one. */
  prevRx: number;
  prevTx: number;
  /** When we last observed it, to tell a live gap from a resumed one. 0 forces
   *  the next reading to re-baseline instead of measuring across it. */
  lastPollMs: number;
}

/** On-disk shape. The legacy format was a bare TotalState[] with the counter
 *  fields inlined per MAC; restore() still reads it. */
interface SnapshotV2 {
  totals: TotalState[];
  counters: Array<[string, Array<[string, EntryCounter]>]>;
}

interface LegacyTotalState extends TotalState {
  prevRx: number;
  prevTx: number;
  lastPollMs: number;
}

/**
 * A poll gap wider than this means we stopped watching (a restart, a paused
 * laptop): the delta across it would span traffic we did not measure, so we
 * re-baseline instead of counting it. Matches the throughput tracker's ceiling.
 */
const MAX_GAP_MS = 15_000;

/** When a per-entry counter is old enough to sweep on compact(): far beyond any
 *  measurable gap, so dropping it can never lose a delta that would have counted. */
const STALE_COUNTER_MS = 3_600_000;

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
  /** mac → entryId → last reading. Split from `states` so two roster entries
   *  sharing a cloned MAC each delta against their own counter stream while
   *  still accumulating into the one per-MAC total. */
  private counters = new Map<string, Map<string, EntryCounter>>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.restore();
  }

  /** Whether a device already has an entry — the historian checks this before
   *  seeding, so a restart never re-seeds over an accumulated total. */
  has(macAddress: string): boolean {
    return this.states.has(macAddress);
  }

  /**
   * Establish a device's opening total for the current month from history the
   * historian already holds, before the first live counter is observed. No-op if
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
   *
   * `entryId` names the roster entry the reading came from — the router's
   * clientId. Two devices sharing a cloned MAC arrive as two entries, and each
   * deltas only against itself; both deltas land in the same per-MAC total.
   * Readings without a distinguishing id fall back to the MAC, which is the
   * previous behaviour exactly.
   */
  observe(
    macAddress: string,
    rxBytes: number,
    txBytes: number,
    atMs: number,
    name?: string,
    entryId: string = macAddress,
  ): void {
    let state = this.states.get(macAddress);
    if (!state) {
      state = {
        macAddress,
        name,
        rxBytes: 0,
        txBytes: 0,
        sinceMs: monthStartMs(atMs),
        lastSeenMs: atMs,
        periodMonth: monthOf(atMs),
      };
      this.states.set(macAddress, state);
    }
    const entries = this.counters.get(macAddress) ?? new Map<string, EntryCounter>();
    this.counters.set(macAddress, entries);

    const month = monthOf(atMs);
    if (month !== state.periodMonth) {
      // First sighting in a new month: start its bucket fresh. The delta that
      // straddles the boundary is dropped rather than split — one interval.
      // Every entry re-baselines, not just this one, so a sibling entry
      // observed later in the same batch cannot leak its straddling delta
      // into the new bucket either.
      state.rxBytes = 0;
      state.txBytes = 0;
      state.periodMonth = month;
      state.sinceMs = monthStartMs(atMs);
      for (const entry of entries.values()) entry.lastPollMs = 0;
    } else {
      const entry = entries.get(entryId);
      const measurable =
        entry !== undefined && entry.lastPollMs !== 0 && atMs - entry.lastPollMs <= MAX_GAP_MS;
      if (measurable) {
        state.rxBytes += rxBytes >= entry.prevRx ? rxBytes - entry.prevRx : rxBytes;
        state.txBytes += txBytes >= entry.prevTx ? txBytes - entry.prevTx : txBytes;
      }
    }
    entries.set(entryId, { prevRx: rxBytes, prevTx: txBytes, lastPollMs: atMs });
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
   *  off the list; if it is still active the historian re-creates a fresh entry on
   *  the next poll, but an offline device stays gone. Returns whether anything was
   *  removed. */
  remove(macAddress: string): boolean {
    this.counters.delete(macAddress);
    return this.states.delete(macAddress);
  }

  /** Delete every record. */
  clear(): void {
    this.states.clear();
    this.counters.clear();
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
        this.counters.delete(mac);
        dropped++;
      }
    }
    // A counter is only measurable within MAX_GAP_MS of its last reading, so a
    // stale one is a dead entry id (a re-associated client). Sweeping them
    // keeps a device that churns ids from growing its map forever.
    for (const [mac, entries] of this.counters) {
      for (const [entryId, entry] of entries) {
        if (nowMs - entry.lastPollMs > STALE_COUNTER_MS) entries.delete(entryId);
      }
      if (entries.size === 0) this.counters.delete(mac);
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
      const persisted = JSON.parse(readFileSync(this.filePath, "utf8")) as
        | SnapshotV2
        | LegacyTotalState[];
      if (Array.isArray(persisted)) {
        // Legacy snapshot: the counter was inlined per MAC. Carry it over as
        // that MAC's single entry so a fast restart still measures across.
        for (const row of persisted) {
          const { prevRx, prevTx, lastPollMs, ...state } = row;
          this.states.set(state.macAddress, state);
          if (lastPollMs) {
            this.counters.set(
              state.macAddress,
              new Map([[state.macAddress, { prevRx, prevTx, lastPollMs }]]),
            );
          }
        }
        return;
      }
      for (const state of persisted.totals ?? []) this.states.set(state.macAddress, state);
      for (const [mac, entries] of persisted.counters ?? [])
        this.counters.set(mac, new Map(entries));
    } catch {
      // unreadable snapshot: start fresh rather than refuse to boot
    }
  }

  /** Persist so a restart resumes the running totals rather than seeding anew. */
  snapshot(): void {
    try {
      const persisted: SnapshotV2 = {
        totals: [...this.states.values()],
        counters: [...this.counters].map(([mac, entries]) => [mac, [...entries]]),
      };
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(persisted));
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed snapshot costs at most the interval's accumulation on a restart
    }
  }
}
