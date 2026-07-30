// Per-device data-usage odometer, bucketed by billing month — the persistence-
// agnostic core shared by both recorders.
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
// bytes — not an integral of sampled rates — and, persisted, it survives
// reconnects and restarts.
//
// Identity is the router's `clientId`, not the MAC. The Starlink router masks
// every client MAC to its vendor OUI (`60:74:f4:XX:XX:XX`) over the LAN, so two
// devices of the same brand (four Govee lights here) arrive with an identical
// MAC string — keyed by MAC they would merge into one total. clientId is the only
// unmasked, unique-per-device id, and is stable across reboots/power-off, so each
// device gets its own bucket. clientId is reissued by a factory reset, so on an
// unknown clientId we re-anchor to an orphaned bucket when the (masked) MAC is
// unique to one device; a same-vendor group cannot be re-anchored (its MAC is
// shared and the full MAC is cloud-only) and correctly starts fresh.
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
// an outage. A recorder seeds the opening value once from the per-minute history
// it already holds, so day one is not zero; anything older than that is gone.
//
// Persistence lives in each recorder: the desktop wraps this with an fs snapshot,
// the extension with IndexedDB. loadSnapshot / toSnapshot are the bridge — the
// whole internal state serializes, so a torn-down worker resumes exactly.

export interface ClientTotal {
  /** Router's stable per-device id — the identity this odometer is keyed by.
   *  Undefined only for a legacy/seeded bucket awaiting its first live poll. */
  clientId?: number;
  /** The (vendor-masked) MAC. Kept as re-anchoring evidence, never the key. */
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

export interface TotalState extends ClientTotal {
  /** Which month the totals belong to, as `year * 12 + month` (local). */
  periodMonth: number;
  /** Last counter values, to delta the next reading against. One stream per state
   *  (a state is one clientId), so the counters live here rather than in a map. */
  prevRx: number;
  prevTx: number;
  /** When the counter was last read. 0 forces the next reading to re-baseline
   *  instead of measuring across it (a fresh bucket, an adoption, a month roll). */
  lastPollMs: number;
}

/**
 * On-disk shape — the only one. The number is 3 rather than 1 because two
 * earlier shapes existed during development; nothing outside this machine ever
 * wrote them, so their readers are gone. It stays 3 because renumbering would
 * make a stored snapshot reject and start the totals from zero.
 */
export const VERSION = 3;

export interface Snapshot {
  version: typeof VERSION;
  totals: TotalState[];
  /** OUIs ever seen carrying >=2 concurrent devices — so a same-vendor group is
   *  never re-anchored across a reset even if only one member is back online. */
  sharedMacs: string[];
}

/**
 * A poll gap wider than this means we stopped watching (a restart, a paused
 * laptop): the delta across it would span traffic we did not measure, so we
 * re-baseline instead of counting it. The default matches the throughput
 * tracker's ceiling for a ~1 Hz recorder; a coarser recorder passes its own,
 * wide enough that a normal inter-poll gap is measured rather than skipped.
 */
export const DEFAULT_MAX_GAP_MS = 15_000;

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

/** The map key for a device: its clientId when known, else the MAC (a legacy or
 *  freshly-seeded bucket that has not yet been matched to a live clientId). A
 *  numeric clientId string and a colon-bearing MAC never collide. */
function keyOf(clientId: number | undefined, macAddress: string): string {
  return clientId !== undefined ? String(clientId) : macAddress;
}

export class ClientTotalsCore {
  private states = new Map<string, TotalState>();
  /** OUIs proven to carry more than one device (seen concurrently). Persisted, so
   *  it survives a factory reset that reissues clientIds — the one thing that lets
   *  us keep a same-vendor group from wrongly re-anchoring after a reset. */
  private sharedMacs = new Set<string>();

  constructor(private readonly maxGapMs: number = DEFAULT_MAX_GAP_MS) {}

  /** Replace all state from a persisted snapshot. The caller has already checked
   *  the version — a mismatch is a shape this build cannot read, and starting
   *  fresh beats loading it wrong. */
  loadSnapshot(snapshot: Snapshot): void {
    this.states.clear();
    this.sharedMacs.clear();
    for (const state of snapshot.totals)
      this.states.set(keyOf(state.clientId, state.macAddress), state);
    for (const mac of snapshot.sharedMacs) this.sharedMacs.add(mac);
  }

  /** The whole internal state, ready to persist — enough to resume exactly. */
  toSnapshot(): Snapshot {
    return {
      version: VERSION,
      totals: [...this.states.values()],
      sharedMacs: [...this.sharedMacs],
    };
  }

  /** Whether any bucket already covers this MAC — the seed guard, so a restart
   *  never lays down a second (later-double-counted) bucket for a device already
   *  tracked under its clientId. */
  hasMac(macAddress: string): boolean {
    for (const state of this.states.values()) if (state.macAddress === macAddress) return true;
    return false;
  }

  /**
   * Establish a device's opening total for the current month from history the
   * recorder already holds, before its first live counter is observed. Seeded as
   * a MAC-keyed bucket (no clientId yet); the first live poll re-keys it to the
   * device's clientId via adoption. No-op — and returns false — if any bucket
   * already covers this MAC, so it is safe to call unconditionally at startup.
   */
  seed(macAddress: string, rxBytes: number, txBytes: number, atMs: number, name?: string): boolean {
    if (this.hasMac(macAddress)) return false;
    this.states.set(keyOf(undefined, macAddress), {
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
    return true;
  }

  /**
   * The device that owns throughput rows recorded on this MAC before per-device
   * keying existed, or undefined if no single device can claim them.
   *
   * A MAC the router ever showed carrying two devices at once is disqualified
   * outright: its old rows are the vendor group's summed traffic and belong to
   * nobody. Otherwise the claimant is the one clientId-keyed bucket wearing the
   * MAC. Buckets without a clientId are ignored rather than counted — a device
   * seen before and after adoption has both, and counting the pair as "more than
   * one device" would strip an unshared device of its own history.
   */
  resolveLegacyMac(macAddress: string): string | undefined {
    if (this.sharedMacs.has(macAddress)) return undefined;
    const keyed = [...this.states.values()].filter(
      (state) => state.macAddress === macAddress && state.clientId !== undefined,
    );
    return keyed.length === 1 ? keyOf(keyed[0].clientId, keyed[0].macAddress) : undefined;
  }

  /**
   * Learn which OUIs are shared and return this poll's live keys. Called once per
   * poll, before the observe loop, with every live client. An OUI seen carrying
   * two or more devices at once is flagged shared for good (persisted), which is
   * what makes adoption robust to a reset where a same-vendor group trickles back
   * one device at a time. Flagging an OUI shared also drops any legacy merged
   * bucket still sitting on it (a pre-clientId total for the whole vendor).
   */
  notePoll(entries: ReadonlyArray<{ clientId?: number; macAddress: string }>): Set<string> {
    const liveKeys = new Set<string>();
    const liveByMac = new Map<string, number>();
    for (const entry of entries) {
      liveKeys.add(keyOf(entry.clientId, entry.macAddress));
      liveByMac.set(entry.macAddress, (liveByMac.get(entry.macAddress) ?? 0) + 1);
    }
    for (const [mac, count] of liveByMac) {
      if (count > 1 && !this.sharedMacs.has(mac)) {
        this.sharedMacs.add(mac);
        this.states.delete(keyOf(undefined, mac));
      }
    }
    return liveKeys;
  }

  /**
   * Fold one counter reading into the running total.
   *
   * The delta is `counter - prev` normally; on a counter that went backwards —
   * the router restarting it on re-association — the new value *is* the traffic
   * since the reset, so it is added whole. A first sighting, a gap too wide to
   * measure across, an adoption, or the first reading of a new month only
   * re-baselines and adds nothing.
   *
   * `liveKeys` is this poll's set (from notePoll), used to tell an orphan bucket
   * from a live one when re-anchoring an unknown clientId.
   */
  observe(
    clientId: number | undefined,
    macAddress: string,
    rxBytes: number,
    txBytes: number,
    atMs: number,
    name: string | undefined,
    liveKeys: Set<string>,
  ): void {
    const key = keyOf(clientId, macAddress);
    let state = this.states.get(key);
    if (!state) state = this.adoptOrCreate(clientId, macAddress, atMs, name, liveKeys, key);

    const month = monthOf(atMs);
    if (month !== state.periodMonth) {
      // First sighting in a new month: start its bucket fresh. The delta that
      // straddles the boundary is dropped rather than split — one interval.
      state.rxBytes = 0;
      state.txBytes = 0;
      state.periodMonth = month;
      state.sinceMs = monthStartMs(atMs);
    } else if (state.lastPollMs !== 0 && atMs - state.lastPollMs <= this.maxGapMs) {
      state.rxBytes += rxBytes >= state.prevRx ? rxBytes - state.prevRx : rxBytes;
      state.txBytes += txBytes >= state.prevTx ? txBytes - state.prevTx : txBytes;
    }
    state.prevRx = rxBytes;
    state.prevTx = txBytes;
    state.lastPollMs = atMs;
    state.lastSeenMs = atMs;
    if (name) state.name = name;
  }

  /**
   * Bucket for an unknown clientId. Re-anchors to an orphaned bucket only when the
   * masked MAC is unique to one device — exactly one stored bucket carries it and
   * that bucket is not live this poll — and the OUI was never seen shared. That
   * covers a factory reset for a single-vendor device (its clientId changed but
   * the MAC did not) with no loss. A shared OUI, or more than one bucket on the
   * MAC, means a same-vendor group: it cannot be re-anchored, so start fresh.
   */
  private adoptOrCreate(
    clientId: number | undefined,
    macAddress: string,
    atMs: number,
    name: string | undefined,
    liveKeys: Set<string>,
    key: string,
  ): TotalState {
    if (clientId !== undefined && !this.sharedMacs.has(macAddress)) {
      // Count ALL buckets on this MAC (not orphans-first): two orphans plus a live
      // one must read as "not unique", not as a single adoptable candidate.
      const onMac = [...this.states.values()].filter(
        (s) => s.macAddress === macAddress && keyOf(s.clientId, s.macAddress) !== key,
      );
      const orphan = onMac[0];
      if (onMac.length === 1 && !liveKeys.has(keyOf(orphan.clientId, orphan.macAddress))) {
        this.states.delete(keyOf(orphan.clientId, orphan.macAddress));
        orphan.clientId = clientId;
        orphan.lastPollMs = 0; // re-baseline: the first reading after adoption adds nothing
        this.states.set(key, orphan);
        return orphan;
      }
    }
    const fresh: TotalState = {
      clientId,
      macAddress,
      name,
      rxBytes: 0,
      txBytes: 0,
      sinceMs: monthStartMs(atMs),
      lastSeenMs: atMs,
      periodMonth: monthOf(atMs),
      prevRx: 0,
      prevTx: 0,
      lastPollMs: 0,
    };
    this.states.set(key, fresh);
    return fresh;
  }

  /** Zero one device's total but keep the bucket, so it stays listed and counts
   *  forward from now. `prev` is left as-is, so the next reading is a normal delta
   *  rather than a jump. Keyed by clientId. Returns whether the device existed. */
  reset(clientKey: string, atMs: number): boolean {
    const state = this.states.get(clientKey);
    if (!state) return false;
    state.rxBytes = 0;
    state.txBytes = 0;
    state.sinceMs = atMs;
    return true;
  }

  /** Delete one device's record entirely — not a counter reset. If it is still
   *  active a fresh bucket is created on the next poll; an offline device stays
   *  gone. Keyed by clientId. Returns whether anything was removed. */
  remove(clientKey: string): boolean {
    return this.states.delete(clientKey);
  }

  /** Delete every record. */
  clear(): void {
    this.states.clear();
  }

  /** Drop devices unseen since before last month so the list cannot grow forever.
   *  Month-aligned rather than a day count: a device seen anywhere in the previous
   *  calendar month survives through this one. Returns how many were dropped. */
  compact(nowMs: number): number {
    const cutoff = previousMonthStartMs(nowMs);
    let dropped = 0;
    for (const [key, state] of this.states) {
      if (state.lastSeenMs < cutoff) {
        this.states.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /** Public totals, one device (by clientId key) or all (newest activity first).
   *  Internal fields (`prev*`, `lastPollMs`, `periodMonth`) are stripped. */
  totals(clientKey?: string): ClientTotal[] {
    const strip = (s: TotalState): ClientTotal => ({
      clientId: s.clientId,
      macAddress: s.macAddress,
      name: s.name,
      rxBytes: s.rxBytes,
      txBytes: s.txBytes,
      sinceMs: s.sinceMs,
      lastSeenMs: s.lastSeenMs,
    });
    if (clientKey) {
      const state = this.states.get(clientKey);
      return state ? [strip(state)] : [];
    }
    return [...this.states.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs).map(strip);
  }
}
