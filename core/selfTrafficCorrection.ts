// Takes a recorder's own polling back out of the usage it records for the
// machine it runs on.
//
// The dish and the router are on the host's own Wi-Fi, so every call a recorder
// makes to them is traffic the router's per-client byte counters attribute to
// that host. None of it reaches the internet, and none of it is on the Starlink
// plan, but the odometer and the per-device throughput chart both read those
// counters and so both bill the host for the recording itself.
//
// The correction is a measurement, not an estimate: core/grpcWeb reports what
// each call actually cost, so every install subtracts its own figure and none
// of this depends on a constant tuned against one machine.
//
// It is expressed as a corrected counter rather than as a second argument to
// each consumer, so core/clientTotals and core/throughputTracker are untouched
// and keep their reset and gap handling exactly as they are.

import { advance, MAX_BYTES_PER_MS } from "./clientTotals";

/** A poll's raw reading, as the router reported it. */
export interface RawCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Bytes this recorder itself spent since the last poll, split the way the
 * router counts: what we received is the host's rx, what we sent is its tx.
 */
export interface SelfTrafficBytes {
  receivedBytes: number;
  sentBytes: number;
}

interface Side {
  /** Last raw reading, to measure the next one against. */
  previousRaw: number;
  /** The counter as the consumers see it: raw with our own traffic taken out. */
  corrected: number;
  /**
   * Self-traffic measured but not yet subtracted, carried to the next poll.
   *
   * Not an optimisation. The recorder polls several times per router refresh
   * (200ms against ~1005ms), so most polls read a counter that has not moved
   * while our own traffic accrued regardless. Subtracting within a single poll
   * and flooring at zero would discard that poll's share every time, leaving
   * roughly a fifth of the correction applied. The debt survives to the poll
   * where the counter does step and is paid down against a real delta.
   */
  debtBytes: number;
}

function newSide(): Side {
  return { previousRaw: 0, corrected: 0, debtBytes: 0 };
}

/** Enough to resume exactly, for a recorder torn down between polls. */
export interface SelfTrafficSnapshot {
  receiveSide: Side;
  sendSide: Side;
  lastApplyMs: number;
}

/**
 * The host's corrected counters, one instance per recorder.
 *
 * Holds no identity of its own: the caller decides which roster entry is the
 * host and feeds only that one through.
 */
export class SelfTrafficCorrection {
  private receiveSide = newSide();
  private sendSide = newSide();
  private lastApplyMs = 0;
  private pendingSelfTraffic: SelfTrafficBytes = { receivedBytes: 0, sentBytes: 0 };

  /**
   * Add what a call cost. Called as calls complete, which is between polls, so
   * it only accrues — the arithmetic happens when the next reading arrives.
   */
  record(bytes: SelfTrafficBytes): void {
    this.pendingSelfTraffic.receivedBytes += bytes.receivedBytes;
    this.pendingSelfTraffic.sentBytes += bytes.sentBytes;
  }

  /**
   * Resume from a persisted snapshot. Pending traffic is deliberately not
   * carried: it was measured by a process that is gone, and the reading it
   * would have been charged against never arrived.
   */
  loadSnapshot(snapshot: SelfTrafficSnapshot): void {
    this.receiveSide = { ...snapshot.receiveSide };
    this.sendSide = { ...snapshot.sendSide };
    this.lastApplyMs = snapshot.lastApplyMs;
  }

  toSnapshot(): SelfTrafficSnapshot {
    return {
      receiveSide: { ...this.receiveSide },
      sendSide: { ...this.sendSide },
      lastApplyMs: this.lastApplyMs,
    };
  }

  /**
   * Drop what has accrued since the last reading, unspent.
   *
   * For a poll that produced no reading to charge it against: the recorder is
   * not on the router's own network, or is but was left out of the roster this
   * time. Holding it instead would let a debt build for as long as that lasts
   * and then take a bite out of real traffic the moment the row came back.
   */
  forgetPending(): void {
    this.pendingSelfTraffic = { receivedBytes: 0, sentBytes: 0 };
  }

  /** Fold one raw reading in and return what the consumers should see. */
  apply(raw: RawCounters, atMs: number): RawCounters {
    const selfTraffic = this.pendingSelfTraffic;
    this.pendingSelfTraffic = { receivedBytes: 0, sentBytes: 0 };

    // The first reading establishes the baseline both sides measure from; there
    // is no delta yet, so the traffic that led up to it is not ours to remove.
    if (this.lastApplyMs === 0) {
      this.lastApplyMs = atMs;
      this.receiveSide.previousRaw = raw.rxBytes;
      this.receiveSide.corrected = raw.rxBytes;
      this.sendSide.previousRaw = raw.txBytes;
      this.sendSide.corrected = raw.txBytes;
      return { rxBytes: raw.rxBytes, txBytes: raw.txBytes };
    }

    // What the fastest link could have carried since the last reading — the same
    // bound clientTotals puts on a restarted counter, so a reset is treated
    // identically on both sides of this correction.
    const ceilingBytes = Math.max(0, atMs - this.lastApplyMs) * MAX_BYTES_PER_MS;
    this.lastApplyMs = atMs;
    return {
      rxBytes: applySide(this.receiveSide, raw.rxBytes, selfTraffic.receivedBytes, ceilingBytes),
      txBytes: applySide(this.sendSide, raw.txBytes, selfTraffic.sentBytes, ceilingBytes),
    };
  }
}

function applySide(
  side: Side,
  raw: number,
  selfTrafficBytes: number,
  ceilingBytes: number,
): number {
  side.debtBytes += selfTrafficBytes;

  // A counter that went backwards is the router restarting it on
  // re-association, and the reset is mirrored rather than smoothed over. Both
  // consumers key off it: clientTotals adds a restarted counter whole, and
  // throughputTracker falls back to the router's own average instead of
  // dividing the whole post-reset value by one poll interval.
  const rawAdvance = advance(raw, side.previousRaw, ceilingBytes);
  const applied = Math.min(side.debtBytes, rawAdvance);
  side.debtBytes -= applied;
  side.corrected =
    raw < side.previousRaw ? rawAdvance - applied : side.corrected + rawAdvance - applied;
  side.previousRaw = raw;
  return side.corrected;
}
