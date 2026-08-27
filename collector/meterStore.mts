// The desktop's metering rules: the shared decision core with an fs snapshot
// behind it.
//
// The arithmetic — cycle boundaries, anchors, when a limit is reached — is
// evaluateMeters in core/dataMeter, shared with the extension. This adds what a
// process that stays up can offer it: the rules held in memory so the 200 ms
// poll reads no disk, written back only when one moves, and each rule's key
// resolved through the odometer so a reissued identity keeps its rule.
//
// The block each device is under rides in the same snapshot, because the two are
// read together on every poll and a device held by a rule that did not survive
// the same write is exactly the state neither of them should ever be in.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  announcementSubject,
  chargedBytes,
  listChanged,
  evaluateMeters,
  resolveRuleKeys,
  restartCycle,
  restoredRule,
  ruleKey,
  sharedUsageByGroup,
  upsertRule,
  type MeterCycle,
  type MeterReading,
  type MeterRoster,
  type MeterRule,
  type MeterTransition,
} from "../core/dataMeter.ts";
import {
  clearSettledOverrides,
  forgetSettled,
  notePause,
  type DevicePause,
  type DevicePauses,
  type PauseState,
} from "../core/devicePause.ts";
import { projectGroupRules, type DeviceGroup } from "../core/deviceGroup.ts";
import type { Schedule } from "../core/schedule.ts";

const VERSION = 2;

/** How long a rule's advancing counters may sit unwritten. They are re-read from
 *  the odometer on the first poll after a restart, so the only thing this delays
 *  is a disk write the 200 ms poll would otherwise make five times a second. */
const COUNTER_FLUSH_MS = 30_000;

interface Snapshot {
  version: number;
  rules: MeterRule[];
  pauses?: DevicePause[];
}

/** A rule as version 1 wrote it, when the block was a field on the rule. */
type StoredRule = MeterRule & {
  pauseState?: PauseState;
  pauseCheckedMs?: number;
  pauseError?: string;
};

/**
 * A version 1 snapshot as version 2 reads it: the block lifted off the rules and
 * onto the devices they name.
 *
 * Version 1 allowed one rule per device, so there is never more than one block to
 * lift per device and nothing has to be reconciled here.
 */
function liftPauses(stored: StoredRule[]): { rules: MeterRule[]; pauses: DevicePause[] } {
  const pauses: DevicePause[] = [];
  const rules = stored.map(({ pauseState, pauseCheckedMs, pauseError, ...rule }) => {
    if (pauseState !== undefined && pauseState !== "none")
      pauses.push({
        clientKey: rule.clientKey,
        state: pauseState,
        ...(pauseCheckedMs === undefined ? {} : { checkedMs: pauseCheckedMs }),
        ...(pauseError === undefined ? {} : { error: pauseError }),
      });
    return rule;
  });
  return { rules, pauses };
}

export class MeterStore {
  private rules: MeterRule[] = [];
  private blocks: DevicePauses = new Map();
  /** When counters last reached disk, on the caller's clock rather than this
   *  process's, so the flush is judged by the same clock that drives the poll. */
  private countersWrittenMs = 0;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.restore();
  }

  private restore(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const stored = JSON.parse(readFileSync(this.filePath, "utf8")) as Snapshot;
      if (!Array.isArray(stored?.rules) || stored.version > VERSION) return;
      const lifted = liftPauses(stored.rules as StoredRule[]);
      this.rules = lifted.rules.map(restoredRule);
      this.blocks = new Map(
        (stored.pauses ?? lifted.pauses).map((pause) => [pause.clientKey, pause]),
      );
    } catch {
      // unreadable snapshot: start with no rules rather than refuse to boot
    }
  }

  private persist(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(
        tempPath,
        JSON.stringify({
          version: VERSION,
          rules: this.rules,
          pauses: [...this.blocks.values()],
        } satisfies Snapshot),
      );
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed write costs the rule change on a restart, not the recorder
    }
  }

  all(): MeterRule[] {
    return this.rules;
  }

  /** Every rule naming this device: its own, and one for each group it is in. */
  forDevice(clientKey: string): MeterRule[] {
    return this.rules.filter((rule) => rule.clientKey === clientKey);
  }

  /** The block each device is under, as the router last confirmed it. */
  pauses(): DevicePauses {
    return this.blocks;
  }

  /**
   * Bring the rule set in line with the groups: a rule per member carrying the
   * group's terms, and none left over from a group a device has left.
   *
   * Returns the rules that went, as they stood before it, so an announcement one
   * of them raised can be retired under the key it was raised on. A device left
   * blocked by a dropped rule needs nothing from this: the release is owed by the
   * device having no rule holding it, which the next poll asks anyway.
   */
  project(
    groups: readonly DeviceGroup[],
    counters: readonly MeterReading[],
    nowMs: number,
  ): { dropped: MeterRule[]; reannounced: MeterRule[] } {
    const before = this.rules;
    const projected = projectGroupRules({ groups, rules: before, counters, nowMs });
    if (!listChanged(projected, before)) return { dropped: [], reannounced: [] };
    const byKey = new Map(projected.map((rule) => [ruleKey(rule), rule]));
    const dropped: MeterRule[] = [];
    const reannounced: MeterRule[] = [];
    for (const rule of before) {
      const still = byKey.get(ruleKey(rule));
      if (!still) dropped.push(rule);
      else if (announcementSubject(still) !== announcementSubject(rule)) reannounced.push(rule);
    }
    this.rules = projected;
    this.persist();
    return { dropped, reannounced };
  }

  /** Reconcile rules against the odometer's roster. True when any rule moved. */
  resolve(roster: MeterRoster): boolean {
    const kept = resolveRuleKeys(this.rules, roster);
    const changed = listChanged(kept, this.rules);
    if (changed) {
      this.rules = kept;
      this.persist();
    }
    return changed;
  }

  /**
   * Fold one poll's counters through every rule.
   *
   * A transition is an event and is written at once. A rule that only moved its
   * counters is not: a metered device in use moves them on every poll, and the
   * odometer hands them back after a restart, so those ride the flush instead of
   * writing the file five times a second. A cycle that rolls without a transition
   * is re-rolled off the clock on the next poll, which is what makes that safe.
   */
  observe(readings: readonly MeterReading[], nowMs: number): MeterTransition[] {
    const before = this.rules;
    const { rules, transitions } = evaluateMeters(before, readings, nowMs);
    this.rules = rules;
    const moved = listChanged(rules, before);
    if (transitions.length === 0 && (!moved || nowMs - this.countersWrittenMs < COUNTER_FLUSH_MS))
      return transitions;
    this.persist();
    this.countersWrittenMs = nowMs;
    return transitions;
  }

  /** Stamp a write as attempted, before it is sent: a failure that repeats word
   *  for word records no change, and a device left holding its old stamp would be
   *  asked for the same write on the very next poll rather than after the window. */
  noteAttempt(clientKey: string, kind: "pause" | "release", atMs: number): void {
    const held = this.blocks.get(clientKey);
    this.notePause(clientKey, {
      state: held?.state ?? "none",
      ...(held?.error === undefined ? {} : { error: held.error }),
      ...(held?.confirmedMs === undefined ? {} : { confirmedMs: held.confirmedMs }),
      attempted: kind,
      checkedMs: atMs,
    });
  }

  /** Record how a pause write went. */
  notePauseState(clientKey: string, state: PauseState, atMs: number, error?: string): void {
    const held = this.blocks.get(clientKey);
    // The confirmation belongs to the block, so it lasts exactly as long as the
    // block does: a record staying "applied" — a release that would not go
    // through — is the same block the router was seen holding, while any other
    // state is a new write that has still to reach the roster on its own.
    const confirmedMs =
      state === "applied" && held?.state === "applied" ? held.confirmedMs : undefined;
    this.notePause(clientKey, {
      state,
      ...(error === undefined ? {} : { error }),
      ...(held?.attempted === undefined ? {} : { attempted: held.attempted }),
      ...(confirmedMs === undefined ? {} : { confirmedMs }),
      checkedMs: atMs,
    });
  }

  /** The router was seen holding a block this record only knew was sent. */
  noteBlockLanded(clientKey: string, atMs: number): void {
    const held = this.blocks.get(clientKey);
    if (!held) return;
    const { clientKey: _key, ...rest } = held;
    this.notePause(clientKey, { ...rest, confirmedMs: atMs });
  }

  /** The device was freed by hand while rules still held it. Their latches stay
   *  set, so this is what stops the next poll pausing it straight back. */
  noteReleasedByHand(clientKey: string, atMs: number): void {
    this.notePause(clientKey, {
      state: "none",
      attempted: "release",
      checkedMs: atMs,
      overridden: true,
    });
  }

  private notePause(clientKey: string, next: Omit<DevicePause, "clientKey">): void {
    const moved = notePause(this.blocks, clientKey, next);
    if (moved === this.blocks) return;
    this.blocks = forgetSettled(moved, this.rules);
    this.persist();
  }

  /** Drop overrides whose hold is over, so the next limit a device reaches is
   *  enforced as normal. */
  settleOverrides(): void {
    const cleared = clearSettledOverrides(this.blocks, this.rules);
    if (cleared === this.blocks) return;
    this.blocks = cleared;
    this.persist();
  }

  upsert(options: {
    clientKey: string;
    allocationBytes: number;
    autoPause?: boolean;
    cycle: MeterCycle;
    lifetimeRx: number;
    lifetimeTx: number;
    nowMs: number;
    /** Makes the rule a countdown rather than an allowance. */
    countdownMs?: number;
    schedule?: Schedule;
  }): MeterRule {
    // The device's own rule, never one a group is keeping for it: a card setting
    // a limit here has no group behind it, and writing over the group's copy
    // would be undone by the next projection anyway.
    const key = ruleKey({ clientKey: options.clientKey });
    const existing = this.rules.find((rule) => ruleKey(rule) === key);
    const rule = upsertRule(existing, {
      ...options,
      ...(existing ? { chargedBytes: chargedBytes(existing, sharedUsageByGroup(this.rules)) } : {}),
    });
    const index = this.rules.findIndex((other) => ruleKey(other) === key);
    this.rules =
      index === -1
        ? [...this.rules, rule]
        : this.rules.map((other, position) => (position === index ? rule : other));
    this.persist();
    return rule;
  }

  /**
   * Start one rule over: the top-up for a cycle that does not roll on its own,
   * and the way back for a timer that has run out.
   *
   * Scoped to the rule, never to the device. A device answers to as many rules as
   * name it, and restarting by device reaches every one of them — so a timer on a
   * phone would clear the month's usage of every device sharing that phone's
   * allowance. A group's rule is one cycle across its members, so all of them
   * restart together; a device's own rule is only ever its own.
   */
  restart(scope: { clientKey?: string; groupId?: string }, nowMs: number): MeterRule[] {
    const named = (rule: MeterRule) =>
      scope.groupId === undefined
        ? rule.groupId === undefined && rule.clientKey === scope.clientKey
        : rule.groupId === scope.groupId;
    const restarting = new Set(this.rules.filter(named));
    if (restarting.size === 0) return [];
    this.rules = this.rules.map((rule) =>
      restarting.has(rule) ? restartCycle(rule, nowMs) : rule,
    );
    this.persist();
    return this.rules.filter(named);
  }

  /**
   * Start over every rule reading one device's counter.
   *
   * For the counter itself being zeroed, which is the one case where restarting by
   * device is right: every rule measuring it is now anchored above a counter that
   * has gone back to nothing, and none of them can measure anything until they
   * re-anchor. Resetting a *rule* is `restart`, which reaches only that rule.
   */
  restartForCounterReset(clientKey: string, nowMs: number): void {
    const restarting = new Set(this.forDevice(clientKey));
    if (restarting.size === 0) return;
    this.rules = this.rules.map((rule) =>
      restarting.has(rule) ? restartCycle(rule, nowMs) : rule,
    );
    this.persist();
  }

  /** Every rule a device carries, for a device that is no longer metered at all. */
  remove(clientKey: string): boolean {
    return this.removeWhere((rule) => rule.clientKey === clientKey);
  }

  /** Only the rule the device carries itself. The rules its groups keep for it are
   *  each a rule of their own, and the projection writes them straight back. */
  removeOwn(clientKey: string): boolean {
    return this.removeWhere((rule) => rule.clientKey === clientKey && rule.groupId === undefined);
  }

  /** Every rule a group was keeping, for a group that is going. */
  removeGroup(groupId: string): boolean {
    return this.removeWhere((rule) => rule.groupId === groupId);
  }

  private removeWhere(going: (rule: MeterRule) => boolean): boolean {
    const kept = this.rules.filter((rule) => !going(rule));
    if (kept.length === this.rules.length) return false;
    this.rules = kept;
    this.persist();
    return true;
  }

  clear(): void {
    this.rules = [];
    this.persist();
  }
}
