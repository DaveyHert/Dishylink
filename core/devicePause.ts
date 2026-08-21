// What the router was last told about a device, and how that went.
//
// The block belongs to the device: the router keeps one flag per client, and a
// rule is a claim against it rather than the thing itself. Several rules can name
// one device, so no rule can carry the block — the first one edited away would
// take the only record of it, leaving the device shut with nothing left that
// knows to open it.
//
// Held here, the answer is recomputed from whatever rules exist on every poll. A
// rule being dropped, rewritten or moved between groups stops being an event
// anything has to catch: if nothing holds the device any more, the release is
// owed, and the scan that notices costs one pass over the rules.

import { ruleHoldsDevice, type MeterRule } from "./dataMeter";

/** How a device's block stands with the router, so a write that failed is never
 *  reported as an enforced limit. */
export type PauseState = "none" | "pending" | "applied" | "failed";

export interface DevicePause {
  clientKey: string;
  state: PauseState;
  /** When a write was last attempted, so repeats can be spaced. */
  checkedMs?: number;
  /** Which write that was. A release owed because the last rule let go is sent at
   *  once; only a repeat of the same write waits for the retry window. */
  attempted?: "pause" | "release";
  /** Why the last attempt failed. */
  error?: string;
  /**
   * When the router was first seen holding this block.
   *
   * The write returning says only that the account took it. The block reaches the
   * router's own roster seconds later, and that roster is what every reading here
   * comes from — so until this is stamped, a roster calling the device free is
   * this write not having landed yet, and never a person having freed it.
   */
  confirmedMs?: number;
  /**
   * The device was unpaused by hand while a rule was still holding it.
   *
   * Its own fact rather than something read off `state`: the rules go on holding
   * it, so without this the very next poll would find a device owed a pause and
   * overrule the person who just freed it. It stands until every rule has let go,
   * and a rule that holds the device after that pauses it again as normal.
   */
  overridden?: boolean;
}

export type DevicePauses = ReadonlyMap<string, DevicePause>;

/** Whether anything at all still holds this device. */
export function deviceHeld(rules: readonly MeterRule[], clientKey: string): boolean {
  return rules.some((rule) => rule.clientKey === clientKey && ruleHoldsDevice(rule));
}

/** Devices some rule holds and that enforce it. A rule watching without pausing
 *  still holds the device in every other sense — it is announced, and it keeps
 *  the cycle latched — but it owes the router nothing. */
export function devicesOwedPause(rules: readonly MeterRule[]): string[] {
  const owed = new Set<string>();
  for (const rule of rules) if (rule.autoPause && ruleHoldsDevice(rule)) owed.add(rule.clientKey);
  return [...owed];
}

/** Whether a write of this kind is due now: the first one always, a repeat only
 *  once the retry window has passed. */
function dueNow(
  pause: DevicePause | undefined,
  kind: DevicePause["attempted"],
  nowMs: number,
  retryMs: number,
): boolean {
  if (!pause || pause.attempted !== kind) return true;
  return nowMs - (pause.checkedMs ?? 0) >= retryMs;
}

/** A write that never came back. One in flight settles in seconds, so past the
 *  whole retry window nothing is waiting on it. */
function stalled(pause: DevicePause, nowMs: number, retryMs: number): boolean {
  return nowMs - (pause.checkedMs ?? 0) >= retryMs;
}

/**
 * Devices whose pause has not landed and is owed another attempt.
 *
 * A write in flight settles in seconds, so a "pending" older than the whole retry
 * window never came back and is as stalled as one that failed outright. A device
 * someone unpaused by hand reads as "none" and is not here: their release stands
 * until something else holds the device again.
 *
 * A write the router has never been seen acting on is owed another one. The
 * account taking it is not the router applying it, and without this a block that
 * was accepted and then quietly dropped would be asked about by nothing ever
 * again — "applied" is the one state no other path here retries.
 */
export function pausesOwed(
  rules: readonly MeterRule[],
  pauses: DevicePauses,
  nowMs: number,
  retryMs: number,
): string[] {
  return devicesOwedPause(rules).filter((clientKey) => {
    const pause = pauses.get(clientKey);
    if (pause?.overridden) return false;
    const state = pause?.state ?? "none";
    if (state === "applied" && pause?.confirmedMs !== undefined) return false;
    // Never written for at all, so the first attempt is owed now rather than
    // after a window nothing has started.
    if (state === "none" && pause?.attempted !== "pause") return true;
    return dueNow(pause, "pause", nowMs, retryMs);
  });
}

/**
 * Records with an override that has outlived what it was overruling.
 *
 * The person's release stands for as long as the rules that were holding the
 * device do. Once they have all let go, the override means nothing — and leaving
 * it would keep the device exempt from the next limit it reaches.
 */
export function clearSettledOverrides(
  pauses: DevicePauses,
  rules: readonly MeterRule[],
): DevicePauses {
  const going = [...pauses.values()].filter(
    (pause) => pause.overridden && !deviceHeld(rules, pause.clientKey),
  );
  if (going.length === 0) return pauses;
  const next = new Map(pauses);
  for (const pause of going) {
    const kept = { ...pause };
    delete kept.overridden;
    next.set(pause.clientKey, kept);
  }
  return next;
}

/**
 * Devices the router is holding that no rule holds any more.
 *
 * This is the whole release path. Every way a device stops being metered — the
 * cycle rolling, a window opening, an allowance raised, a rule deleted, a group
 * edited, a member moved to another group — ends in no rule holding it, and is
 * answered here rather than by whichever code path made the change.
 *
 * A stalled "pending" counts as held: the write may have reached the router
 * before the reply was lost, and `pausesOwed` retries one only while a rule is
 * still holding, so nothing else would ever ask about it again. Releasing a pause
 * that never landed changes nothing, which is why the doubt resolves this way. A
 * pending inside the window is still in flight and must not be overtaken.
 */
export function releasesOwed(
  rules: readonly MeterRule[],
  pauses: DevicePauses,
  nowMs: number,
  retryMs: number,
): string[] {
  const owed: string[] = [];
  for (const pause of pauses.values()) {
    const blocked =
      pause.state === "applied" || (pause.state === "pending" && stalled(pause, nowMs, retryMs));
    if (!blocked) continue;
    if (deviceHeld(rules, pause.clientKey)) continue;
    if (dueNow(pause, "release", nowMs, retryMs)) owed.push(pause.clientKey);
  }
  return owed;
}

/**
 * Blocks the router is now seen holding that this record does not know landed.
 *
 * The one place the roster's `true` is read. Everything else here asks whether a
 * device is free, which is the same reading a write still in the post gives — so
 * without this there is nothing to tell "not blocked yet" from "not blocked any
 * more", and the two have opposite answers.
 */
export function blocksLanded(
  pauses: DevicePauses,
  blocked: ReadonlyMap<string, boolean>,
): string[] {
  return [...pauses.values()]
    .filter(
      (pause) =>
        pause.state === "applied" &&
        pause.confirmedMs === undefined &&
        blocked.get(pause.clientKey) === true,
    )
    .map((pause) => pause.clientKey);
}

/**
 * Devices the router says are free while this record still calls them held.
 *
 * The router is the authority on whether a device is blocked, so where the two
 * disagree this is the stale half. A key the poll did not carry is "not asked",
 * never "not blocked".
 *
 * Only a block the router was seen holding can be released by hand — a device has
 * to be shut before anyone can open it. An unconfirmed write reads as free for
 * the seconds it takes to reach the roster, and answering that with an override
 * would exempt the device from the very rule that had just paused it.
 */
export function releasedByHand(
  pauses: DevicePauses,
  blocked: ReadonlyMap<string, boolean>,
): string[] {
  return [...pauses.values()]
    .filter(
      (pause) =>
        pause.state === "applied" &&
        pause.confirmedMs !== undefined &&
        blocked.get(pause.clientKey) === false,
    )
    .map((pause) => pause.clientKey);
}

/** The record after a write, or after the router was found to disagree. Returns
 *  the same map when nothing moved, so a caller can skip persisting. */
export function notePause(
  pauses: DevicePauses,
  clientKey: string,
  next: Omit<DevicePause, "clientKey">,
): DevicePauses {
  const held = pauses.get(clientKey);
  if (
    held &&
    held.state === next.state &&
    held.error === next.error &&
    held.attempted === next.attempted &&
    held.overridden === next.overridden &&
    held.confirmedMs === next.confirmedMs &&
    held.checkedMs === next.checkedMs
  )
    return pauses;
  const moved = new Map(pauses);
  moved.set(clientKey, { clientKey, ...next });
  return moved;
}

/** Records for devices nothing knows about any more. A device with no rule and no
 *  block is not a device, it is an empty row that would be written for ever. */
export function forgetSettled(pauses: DevicePauses, rules: readonly MeterRule[]): DevicePauses {
  const metered = new Set(rules.map((rule) => rule.clientKey));
  const kept = [...pauses.values()].filter(
    (pause) => pause.state !== "none" || metered.has(pause.clientKey),
  );
  if (kept.length === pauses.size) return pauses;
  return new Map(kept.map((pause) => [pause.clientKey, pause]));
}
