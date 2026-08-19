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
  evaluateMeters,
  resolveRuleKeys,
  restartCycle,
  upsertRule,
  type MeterCycle,
  type MeterReading,
  type MeterRoster,
  type MeterRule,
  type MeterTransition,
} from "../core/dataMeter.ts";

const VERSION = 1;

interface Snapshot {
  version: typeof VERSION;
  rules: MeterRule[];
}

export class MeterStore {
  private rules: MeterRule[] = [];

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

  /** Reconcile rules against the odometer's roster. True when any rule moved. */
  resolve(roster: MeterRoster): boolean {
    const kept = resolveRuleKeys(this.rules, roster);
    const changed =
      kept.length !== this.rules.length || kept.some((rule, index) => rule !== this.rules[index]);
    if (changed) {
      this.rules = kept;
      this.persist();
    }
    return changed;
  }

  /** Fold one poll's counters through every rule. Persists only when a rule
   *  actually moved, so a poll that changes nothing touches no disk. */
  observe(readings: readonly MeterReading[], nowMs: number): MeterTransition[] {
    const before = this.rules;
    const { rules, transitions } = evaluateMeters(before, readings, nowMs);
    this.rules = rules;
    if (transitions.length > 0 || rules.some((rule, index) => rule !== before[index]))
      this.persist();
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
    const rule = upsertRule(this.find(options.clientKey), options);
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
