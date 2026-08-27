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

/** A month that has finished, as `year * 12 + month` (local) and its usage. */
export interface MonthTotal {
  periodMonth: number;
  rxBytes: number;
  txBytes: number;
}

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
  /** Completed months, oldest first. */
  months?: MonthTotal[];
}

export interface TotalState {
  clientId?: number;
  macAddress: string;
  name?: string;
  /** The router's per-client hash, when it sent one. Kept as re-anchoring
   *  evidence that outlives a MAC change: unlike the MAC it is not something the
   *  device rotates, and unlike clientId it is not reissued by this router on a
   *  rotation. Absent on a bucket recorded before it was collected. */
  captiveClientId?: string;
  /** The one accumulator: authoritative cumulative bytes across every reconnect,
   *  every month and every reset. Only ever grows. */
  lifetimeRx: number;
  lifetimeTx: number;
  /** What the counters read when this month's bucket opened. The monthly figure
   *  is `lifetime - anchor`, so clearing a month means moving the anchor up to
   *  meet the counter rather than zeroing anything. */
  monthAnchorRx: number;
  monthAnchorTx: number;
  /** Start of the month these totals cover (local), epoch ms. */
  sinceMs: number;
  /** Last time the device was observed active, epoch ms. */
  lastSeenMs: number;
  /** Which month the totals belong to, as `year * 12 + month` (local). */
  periodMonth: number;
  /** Written when a month rolls, the only moment its figure is final. */
  months?: MonthTotal[];
  /** Last counter values, to delta the next reading against. One stream per state
   *  (a state is one clientId), so the counters live here rather than in a map. */
  prevRx: number;
  prevTx: number;
  /** When the counter was last read. 0 forces the next reading to re-baseline
   *  instead of measuring across it (a fresh bucket, an adoption, a month roll). */
  lastPollMs: number;
}

/**
 * On-disk shape. A snapshot written by an older build is upgraded on load rather
 * than discarded — see migrateSnapshot, which every recorder restores through.
 */
export const VERSION = 4;

export interface Snapshot {
  version: typeof VERSION;
  totals: TotalState[];
  /** OUIs ever seen carrying >=2 concurrent devices — so a same-vendor group is
   *  never re-anchored across a reset even if only one member is back online. */
  sharedMacs: string[];
  /** Merged-away identity -> the key it was folded into, as pairs. Optional: a
   *  stored snapshot may hold no merges, and must still restore at this version. */
  aliases?: [string, string][];
  /** Alias sources the user asserted by merging. An adoption's alias is inferred,
   *  and only these survive the old identity reporting again. */
  userMerged?: string[];
  /** Pairs the user has said are different devices. The other half of `aliases`:
   *  both record an answer about identity that no signal can derive, so both have
   *  to survive a restart or the same question is asked forever. */
  rejectedPairs?: [string, string][];
}

/** A snapshot holding the month's bytes directly, as builds before the lifetime
 *  counter wrote it. */
interface SnapshotV3 {
  version: 3;
  totals: (Omit<TotalState, "lifetimeRx" | "lifetimeTx" | "monthAnchorRx" | "monthAnchorTx"> & {
    rxBytes: number;
    txBytes: number;
  })[];
  sharedMacs: string[];
  aliases?: [string, string][];
  rejectedPairs?: [string, string][];
}

/**
 * A stored snapshot in the shape this build reads, or null when it is not one.
 * Every recorder restores through this rather than deciding for itself whether a
 * stored shape is readable: reading one wrong raises nothing, it just reports
 * every device as having used nothing.
 *
 * An older snapshot's monthly bytes become the opening lifetime against a zero
 * anchor, so the figure it was showing is the figure it still shows.
 */
export function migrateSnapshot(raw: unknown): Snapshot | null {
  const stored = raw as (Partial<Snapshot> & Partial<SnapshotV3>) | null | undefined;
  if (!stored || !Array.isArray(stored.totals)) return null;
  if (stored.version === VERSION) return stored as Snapshot;
  if (stored.version !== 3) return null;
  const legacy = stored as SnapshotV3;
  return {
    version: VERSION,
    sharedMacs: legacy.sharedMacs,
    aliases: legacy.aliases,
    rejectedPairs: legacy.rejectedPairs,
    totals: legacy.totals.map(({ rxBytes, txBytes, ...rest }) => ({
      ...rest,
      lifetimeRx: rxBytes,
      lifetimeTx: txBytes,
      monthAnchorRx: 0,
      monthAnchorTx: 0,
    })),
  };
}

/** One proposed merge: `fromKey`'s bucket is believed to be the same physical
 *  device as `toKey`'s, on the stated evidence. A proposal only — the odometer
 *  never folds two buckets without being told to. */
export interface MergeCandidate {
  fromKey: string;
  toKey: string;
  /** Why these two were paired, for the confirmation prompt to show. */
  reason: "name";
  /** The shared evidence itself (the name both buckets carry). */
  detail: string;
  /** Whether accepting would add the two byte figures. False when the buckets
   *  cover different months, where the identity joins and the totals stand. */
  foldsBytes: boolean;
  /** What the surviving bucket would read if accepted. Stated here, by the code
   *  that would carry the merge out, so a prompt can quote the outcome without
   *  reproducing the rule that decides it. */
  resultRxBytes: number;
  resultTxBytes: number;
}

/** How long a bucket must have gone unseen to be a merge *source*. A device
 *  whose identity was reissued stops reporting under the old key the moment the
 *  new one appears, so anything still being polled is a different device. */
const MERGE_IDLE_AFTER_MS = 10 * 60_000;

/** Canonical name for an unordered pair of keys. "Not the same device" holds
 *  whichever way round it is asked, so the two orderings must collide. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * A poll gap wider than this means we stopped watching (a restart, a paused
 * laptop): the delta across it would span traffic we did not measure, so we
 * re-baseline instead of counting it. The default matches the throughput
 * tracker's ceiling for a ~1 Hz recorder; a coarser recorder passes its own,
 * wide enough that a normal inter-poll gap is measured rather than skipped.
 */
export const DEFAULT_MAX_GAP_MS = 15_000;

/**
 * The fastest link this router serves, as bytes per millisecond (2.5 Gbps).
 *
 * A restarted counter reads as the traffic since it restarted, but only up to
 * what the link could carry in the time since the last reading. Past that bound
 * the reply is stale or reordered and its counter has already been counted —
 * adding it whole bills every re-association as a fresh counter's worth, which
 * on a device that sleeps and roams is most of them. Traffic a genuine reset
 * carried beyond the bound is lost rather than guessed at.
 */
const MAX_BYTES_PER_MS = 312_500;

/** One counter's contribution since the last reading. */
function advance(counter: number, previous: number, ceilingBytes: number): number {
  if (counter >= previous) return counter - previous;
  return counter <= ceilingBytes ? counter : 0;
}

/** The month's figure: what the counter has added since the month's anchor.
 *  Floored at zero, so an anchor left above the counter by a hand-edited file
 *  reads as a fresh month rather than as negative traffic. */
function monthlyRx(state: TotalState): number {
  return Math.max(0, state.lifetimeRx - state.monthAnchorRx);
}

function monthlyTx(state: TotalState): number {
  return Math.max(0, state.lifetimeTx - state.monthAnchorTx);
}

/** Completed months kept beside the one running. Also how long an absent device
 *  is kept, since dropping it sooner would discard months it still holds. */
export const MONTHS_KEPT = 6;

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

/** Local midnight on the first of the month `months` before `atMs`'s, epoch ms. */
function monthsBackStartMs(atMs: number, months: number): number {
  const date = new Date(monthStartMs(atMs));
  date.setMonth(date.getMonth() - months);
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
  /** Keys that were merged away, each mapped to the bucket it was folded into.
   *  Rows recorded under an old identity resolve through this, so a merge carries
   *  history forward and not just the running total. Entries outlive the bucket
   *  they name: compact() drops buckets by last-seen, and an alias whose source
   *  bucket is long gone is exactly the one an old history row still needs. */
  private aliases = new Map<string, string>();
  /** Sources of an alias the user asserted, as against one adoption inferred. */
  private userMerged = new Set<string>();
  /** Pairs answered "different devices", by canonical pair name, holding the two
   *  keys as asked. Stored raw and compared resolved, so the answer still applies
   *  after either side is merged forward onto a newer identity. */
  private rejectedPairs = new Map<string, [string, string]>();

  constructor(private readonly maxGapMs: number = DEFAULT_MAX_GAP_MS) {}

  /** Replace all state from a persisted snapshot. The caller has already checked
   *  the version — a mismatch is a shape this build cannot read, and starting
   *  fresh beats loading it wrong. */
  loadSnapshot(snapshot: Snapshot): void {
    this.states.clear();
    this.sharedMacs.clear();
    this.aliases.clear();
    this.rejectedPairs.clear();
    this.userMerged.clear();
    for (const state of snapshot.totals)
      this.states.set(keyOf(state.clientId, state.macAddress), state);
    for (const mac of snapshot.sharedMacs) this.sharedMacs.add(mac);
    for (const [from, to] of snapshot.aliases ?? []) this.aliases.set(from, to);
    for (const from of snapshot.userMerged ?? []) this.userMerged.add(from);
    for (const [a, b] of snapshot.rejectedPairs ?? [])
      this.rejectedPairs.set(pairKey(a, b), [a, b]);
  }

  /** The whole internal state, ready to persist — enough to resume exactly. */
  toSnapshot(): Snapshot {
    return {
      version: VERSION,
      totals: [...this.states.values()],
      sharedMacs: [...this.sharedMacs],
      aliases: [...this.aliases],
      userMerged: [...this.userMerged],
      rejectedPairs: [...this.rejectedPairs.values()],
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
      lifetimeRx: rxBytes,
      lifetimeTx: txBytes,
      monthAnchorRx: 0,
      monthAnchorTx: 0,
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
    captiveClientId?: string,
  ): void {
    // An identity the user merged away routes into its survivor however often it
    // comes back. An adoption's alias does not: that one is inferred, and the old
    // id reporting again is evidence against it.
    const raw = keyOf(clientId, macAddress);
    const key = this.userMerged.has(raw) ? this.resolveKey(raw) : raw;
    let state = this.states.get(key);
    if (!state)
      state = this.adoptOrCreate(clientId, macAddress, atMs, name, liveKeys, key, captiveClientId);
    if (captiveClientId) state.captiveClientId = captiveClientId;

    const month = monthOf(atMs);
    if (month !== state.periodMonth) {
      // First sighting in a new month: file the month that just ended, then start
      // the new one fresh. The delta that straddles the boundary is dropped
      // rather than split — one interval.
      const closed = {
        periodMonth: state.periodMonth,
        rxBytes: monthlyRx(state),
        txBytes: monthlyTx(state),
      };
      // An empty month is not filed: a device away since spring would otherwise
      // push its real months out of the window with blanks.
      if (closed.rxBytes > 0 || closed.txBytes > 0)
        state.months = [...(state.months ?? []), closed].slice(-MONTHS_KEPT);
      state.monthAnchorRx = state.lifetimeRx;
      state.monthAnchorTx = state.lifetimeTx;
      state.periodMonth = month;
      state.sinceMs = monthStartMs(atMs);
    } else if (state.lastPollMs !== 0 && atMs - state.lastPollMs <= this.maxGapMs) {
      const ceiling = (atMs - state.lastPollMs) * MAX_BYTES_PER_MS;
      state.lifetimeRx += advance(rxBytes, state.prevRx, ceiling);
      state.lifetimeTx += advance(txBytes, state.prevTx, ceiling);
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
    captiveClientId?: string,
  ): TotalState {
    // The router's own per-client hash, when both buckets carry one, settles
    // identity without consulting the MAC — which is the thing that just changed.
    // Trustworthy on a match even if it should turn out to be MAC-derived: two
    // buckets could then only share it by being the same address, hence the same
    // device. Requires a single non-live holder, so a value seen on two devices
    // at once decides nothing.
    if (captiveClientId) {
      const holders = [...this.states.values()].filter(
        (s) => s.captiveClientId === captiveClientId && keyOf(s.clientId, s.macAddress) !== key,
      );
      if (
        holders.length === 1 &&
        !liveKeys.has(keyOf(holders[0].clientId, holders[0].macAddress))
      ) {
        return this.reanchor(holders[0], clientId, macAddress, key);
      }
    }
    if (clientId !== undefined && !this.sharedMacs.has(macAddress)) {
      // Count ALL buckets on this MAC (not orphans-first): two orphans plus a live
      // one must read as "not unique", not as a single adoptable candidate.
      const onMac = [...this.states.values()].filter(
        (s) => s.macAddress === macAddress && keyOf(s.clientId, s.macAddress) !== key,
      );
      const orphan = onMac[0];
      if (onMac.length === 1 && !liveKeys.has(keyOf(orphan.clientId, orphan.macAddress))) {
        return this.reanchor(orphan, clientId, macAddress, key);
      }
    }
    const fresh: TotalState = {
      clientId,
      macAddress,
      name,
      lifetimeRx: 0,
      lifetimeTx: 0,
      monthAnchorRx: 0,
      monthAnchorTx: 0,
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

  /**
   * Move an orphaned bucket onto the identity the router is now reporting for the
   * same device, keeping its running total.
   *
   * The bucket takes the new clientId and the new MAC: the address it arrived
   * with is one this device will not present again, and both adoption and
   * shared-OUI detection search buckets by MAC. The old key becomes an alias, so
   * throughput rows recorded under it still resolve here.
   *
   * `lastPollMs` is cleared, so the first reading on the new identity establishes
   * a baseline; a delta against the orphan's counters would span however long the
   * device was away.
   */
  private reanchor(
    orphan: TotalState,
    clientId: number | undefined,
    macAddress: string,
    key: string,
  ): TotalState {
    const previousKey = keyOf(orphan.clientId, orphan.macAddress);
    this.states.delete(previousKey);
    orphan.clientId = clientId;
    orphan.macAddress = macAddress;
    orphan.lastPollMs = 0;
    this.states.set(key, orphan);
    if (previousKey !== key) {
      for (const [alias, target] of this.aliases)
        if (target === previousKey) this.aliases.set(alias, key);
      this.aliases.set(previousKey, key);
    }
    return orphan;
  }

  /** Zero one device's total but keep the bucket, so it stays listed and counts
   *  forward from now. `prev` is left as-is, so the next reading is a normal delta
   *  rather than a jump. Keyed by clientId. Returns whether the device existed. */
  reset(clientKey: string, atMs: number): boolean {
    const state = this.states.get(clientKey);
    if (!state) return false;
    state.monthAnchorRx = state.lifetimeRx;
    state.monthAnchorTx = state.lifetimeTx;
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

  /** The bucket a key's data now lives in, following any merges it went through.
   *  A key that was never merged is its own answer. A device whose identity is
   *  reissued repeatedly is merged forward each time, so the oldest key may sit
   *  several hops behind the newest bucket. merge() refuses a target that resolves
   *  back to its source, so the hop limit only bounds a hand-edited file. */
  resolveKey(clientKey: string): string {
    let key = clientKey;
    for (let hops = 0; hops < 32; hops++) {
      const next = this.aliases.get(key);
      if (next === undefined || next === key) return key;
      key = next;
    }
    return key;
  }

  /**
   * Fold `fromKey`'s bucket into `toKey`'s, as one device whose identity the
   * router reissued. The survivor is `toKey` — the identity the router is
   * reporting now, and therefore the only key future polls will look up. Its
   * MAC stays: the source's address is one the device will not present again,
   * and adoption and shared-OUI detection both search buckets by MAC.
   *
   * Bytes are added only when both buckets cover the same month. Totals are a
   * per-month figure and an idle bucket is cleared lazily, so an orphan left
   * over from last month still holds last month's bytes; adding those into the
   * current month would invent traffic. Across a boundary the identity carries
   * and the totals do not.
   *
   * The next reading after a merge re-baselines and adds nothing: the survivor's
   * own counters are kept, but a counter delta measured against them would span
   * the whole time the source was silent.
   *
   * Returns false if either key is unknown or they resolve to one bucket.
   */
  merge(fromKey: string, toKey: string): boolean {
    // A key holding a bucket names that bucket, aliased or not — it is the one the
    // caller is looking at, and following the alias past it would fold nothing.
    const at = (key: string) => (this.states.has(key) ? key : this.resolveKey(key));
    const from = at(fromKey);
    const to = at(toKey);
    if (from === to) return false;
    const source = this.states.get(from);
    const survivor = this.states.get(to);
    if (!source || !survivor) return false;
    // An explicit merge is the later answer about the same pair, so it retires an
    // earlier "different devices" instead of being blocked by it.
    for (const [name, [a, b]] of this.rejectedPairs)
      if (pairKey(this.resolveKey(a), this.resolveKey(b)) === pairKey(from, to))
        this.rejectedPairs.delete(name);

    survivor.lifetimeRx += source.lifetimeRx;
    survivor.lifetimeTx += source.lifetimeTx;
    if (source.periodMonth === survivor.periodMonth) {
      survivor.monthAnchorRx += source.monthAnchorRx;
      survivor.monthAnchorTx += source.monthAnchorTx;
      survivor.sinceMs = Math.min(survivor.sinceMs, source.sinceMs);
    } else {
      // The absorbed lifetime belongs to a month this bucket is not reporting,
      // so the anchor takes all of it and the month reads as it did.
      survivor.monthAnchorRx += source.lifetimeRx;
      survivor.monthAnchorTx += source.lifetimeTx;
    }
    // One device's past under two identities: months either held separately add
    // together, since both were the same device spending.
    const byMonth = new Map<number, MonthTotal>();
    for (const month of [...(survivor.months ?? []), ...(source.months ?? [])]) {
      const held = byMonth.get(month.periodMonth);
      if (held) {
        held.rxBytes += month.rxBytes;
        held.txBytes += month.txBytes;
      } else byMonth.set(month.periodMonth, { ...month });
    }
    if (byMonth.size > 0)
      survivor.months = [...byMonth.values()]
        .sort((a, b) => a.periodMonth - b.periodMonth)
        .slice(-MONTHS_KEPT);

    survivor.lastSeenMs = Math.max(survivor.lastSeenMs, source.lastSeenMs);
    survivor.name ??= source.name;
    survivor.lastPollMs = 0;

    this.states.delete(from);
    // Re-point aliases that terminated at the absorbed bucket before recording
    // this one, so every old key reaches the survivor in a single hop.
    for (const [alias, target] of this.aliases) if (target === from) this.aliases.set(alias, to);
    this.aliases.set(from, to);
    this.userMerged.add(from);
    return true;
  }

  /**
   * Buckets that look like one device the router has issued two identities to.
   *
   * The evidence is a name shared by an idle bucket and a newer one. It is the
   * user's own label from the Starlink app, not a guess — a device that comes
   * back under a reissued clientId arrives unnamed, and gets its old name when
   * the user names it again. An absent name is never evidence: it is the absence
   * of a value, and pairing every unnamed bucket with every other would propose
   * nonsense for a whole network at once.
   *
   * Two idle buckets on one name yield two candidates. Which of them is the same
   * device is a question only the user can answer, and a merge made on a guess is
   * unrecoverable — the losing bucket's bytes are gone.
   */
  mergeCandidates(nowMs: number, idleAfterMs: number = MERGE_IDLE_AFTER_MS): MergeCandidate[] {
    const named = [...this.states.entries()].filter(([, state]) => !!state.name?.trim());
    const candidates: MergeCandidate[] = [];
    for (const [fromKey, source] of named) {
      if (nowMs - source.lastSeenMs <= idleAfterMs) continue;
      for (const [toKey, target] of named) {
        if (toKey === fromKey) continue;
        if (target.lastSeenMs <= source.lastSeenMs) continue;
        if (source.name!.trim().toLowerCase() !== target.name!.trim().toLowerCase()) continue;
        if (this.isRejected(fromKey, toKey)) continue;
        const foldsBytes = source.periodMonth === target.periodMonth;
        candidates.push({
          fromKey,
          toKey,
          reason: "name",
          detail: target.name!.trim(),
          foldsBytes,
          resultRxBytes: monthlyRx(target) + (foldsBytes ? monthlyRx(source) : 0),
          resultTxBytes: monthlyTx(target) + (foldsBytes ? monthlyTx(source) : 0),
        });
      }
    }
    return candidates;
  }

  /**
   * Record that two buckets are different devices, so the pair stops being
   * offered. Same standing as a merge: an answer about identity that nothing in
   * the router's data implies, and useless unless it survives a restart.
   *
   * Symmetric, and unaffected by argument order. Both keys must name a bucket
   * that exists: an answer about two records the store does not hold describes
   * nothing, and being persisted it would never expire. Returns false for that,
   * and for two keys that already name one bucket.
   */
  rejectMerge(aKey: string, bKey: string): boolean {
    const a = this.resolveKey(aKey);
    const b = this.resolveKey(bKey);
    if (a === b) return false;
    if (!this.states.has(a) || !this.states.has(b)) return false;
    this.rejectedPairs.set(pairKey(a, b), [a, b]);
    return true;
  }

  /** Whether the user has said these two are different devices. Compared through
   *  resolveKey, so the answer holds after either side is merged onto a newer
   *  identity — the device it names has not changed, only its key. */
  private isRejected(aKey: string, bKey: string): boolean {
    const wanted = pairKey(this.resolveKey(aKey), this.resolveKey(bKey));
    for (const [a, b] of this.rejectedPairs.values())
      if (pairKey(this.resolveKey(a), this.resolveKey(b)) === wanted) return true;
    return false;
  }

  /** Drop devices unseen for longer than the history window, so the list cannot
   *  grow forever. Month-aligned rather than a day count. Returns how many. */
  compact(nowMs: number): number {
    const cutoff = monthsBackStartMs(nowMs, MONTHS_KEPT);
    let dropped = 0;
    for (const [key, state] of this.states) {
      if (state.lastSeenMs < cutoff) {
        this.states.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /** Every device's counter as it stands, for a reader measuring a span of its
   *  own from an anchor it keeps. Keyed as the store keys it, so a caller holding
   *  an older identity resolves it through resolveKey first. */
  lifetimes(): { clientKey: string; lifetimeRx: number; lifetimeTx: number }[] {
    return [...this.states].map(([clientKey, state]) => ({
      clientKey,
      lifetimeRx: state.lifetimeRx,
      lifetimeTx: state.lifetimeTx,
    }));
  }

  /** Public totals, one device (by clientId key) or all (newest activity first).
   *  Internal fields (`prev*`, `lastPollMs`, `periodMonth`) are stripped. */
  totals(clientKey?: string): ClientTotal[] {
    const strip = (s: TotalState): ClientTotal => ({
      clientId: s.clientId,
      macAddress: s.macAddress,
      name: s.name,
      rxBytes: monthlyRx(s),
      txBytes: monthlyTx(s),
      sinceMs: s.sinceMs,
      lastSeenMs: s.lastSeenMs,
      months: s.months,
    });
    if (clientKey) {
      const state = this.states.get(clientKey);
      return state ? [strip(state)] : [];
    }
    return [...this.states.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs).map(strip);
  }
}
