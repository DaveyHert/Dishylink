// The desktop's metering rules: the shared decision core with an fs snapshot
// behind it.
//
// The arithmetic — cycle boundaries, anchors, when a limit is reached — is
// evaluateMeters in core/dataMeter, shared with the extension. This adds what a
// process that stays up can offer it: the rules held in memory so the 200 ms
// poll reads no disk, written back only when one moves, and each rule's key
// resolved through the odometer so a reissued identity keeps its rule.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  announcementSubject,
  chargedBytes,
  listChanged,
  evaluateMeters,
  resolveRuleKeys,
  restartCycle,
  sharedUsageByGroup,
  upsertRule,
  type MeterCycle,
  type MeterReading,
  type MeterRoster,
  type MeterRule,
  type MeterTransition,
} from "../core/dataMeter.ts";
import { projectGroupRules, type DeviceGroup } from "../core/deviceGroup.ts";

const VERSION = 1;

/** How long a rule's advancing counters may sit unwritten. They are re-read from
 *  the odometer on the first poll after a restart, so the only thing this delays
 *  is a disk write the 200 ms poll would otherwise make five times a second. */
const COUNTER_FLUSH_MS = 30_000;

interface Snapshot {
  version: typeof VERSION;
  rules: MeterRule[];
}

export class MeterStore {
  private rules: MeterRule[] = [];
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
      if (stored?.version === VERSION && Array.isArray(stored.rules)) this.rules = stored.rules;
    } catch {
      // unreadable snapshot: start with no rules rather than refuse to boot
    }
  }

  private persist(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify({ version: VERSION, rules: this.rules } as Snapshot));
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed write costs the rule change on a restart, not the recorder
    }
  }

  all(): MeterRule[] {
    return this.rules;
  }

  find(clientKey: string): MeterRule | undefined {
    return this.rules.find((rule) => rule.clientKey === clientKey);
  }

  /**
   * Bring the rule set in line with the groups: a rule per member carrying the
   * group's terms, and none left over from a group a device has left.
   *
   * Returns the rules that went, as they stood before it. A dropped rule is the
   * last thing that knew a device was paused, and one whose announcement moved to
   * its group owes the old key a clearing.
   */
  project(
    groups: readonly DeviceGroup[],
    counters: readonly MeterReading[],
    nowMs: number,
  ): { dropped: MeterRule[]; reannounced: MeterRule[] } {
    const before = this.rules;
    const projected = projectGroupRules({ groups, rules: before, counters, nowMs });
    if (!listChanged(projected, before)) return { dropped: [], reannounced: [] };
    const byKey = new Map(projected.map((rule) => [rule.clientKey, rule]));
    const dropped: MeterRule[] = [];
    const reannounced: MeterRule[] = [];
    for (const rule of before) {
      const still = byKey.get(rule.clientKey);
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

  /** Stamp a write as attempted. A rule whose write is still in flight reports
   *  the state it had before it, so nothing else marks it as tried. */
  noteAttempt(clientKey: string, atMs: number): void {
    const rule = this.find(clientKey);
    if (!rule) return;
    rule.pauseCheckedMs = atMs;
    this.persist();
  }

  /** Record how a pause write went. False when no rule took the result. */
  notePauseState(
    clientKey: string,
    state: MeterRule["pauseState"],
    atMs: number,
    error?: string,
  ): boolean {
    const rule = this.find(clientKey);
    if (!rule) return false;
    if (rule.pauseState === state && rule.pauseError === error) return true;
    rule.pauseState = state;
    rule.pauseCheckedMs = atMs;
    if (error === undefined) delete rule.pauseError;
    else rule.pauseError = error;
    this.persist();
    return true;
  }

  upsert(options: {
    clientKey: string;
    allocationBytes: number;
    autoPause?: boolean;
    cycle: MeterCycle;
    lifetimeRx: number;
    lifetimeTx: number;
    nowMs: number;
  }): MeterRule {
    const existing = this.find(options.clientKey);
    const rule = upsertRule(existing, {
      ...options,
      ...(existing ? { chargedBytes: chargedBytes(existing, sharedUsageByGroup(this.rules)) } : {}),
    });
    this.rules = [...this.rules.filter((other) => other.clientKey !== options.clientKey), rule];
    this.persist();
    return rule;
  }

  /** Start a rule's allowance over: a top-up, and what resetting a device's
   *  usage means for the rule reading that counter. */
  restart(clientKey: string, nowMs: number): MeterRule | undefined {
    const rule = this.find(clientKey);
    if (!rule) return undefined;
    const restarted = restartCycle(rule, nowMs);
    this.rules = this.rules.map((other) => (other === rule ? restarted : other));
    this.persist();
    return restarted;
  }

  remove(clientKey: string): boolean {
    const kept = this.rules.filter((rule) => rule.clientKey !== clientKey);
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
