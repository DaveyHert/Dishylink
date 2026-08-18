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
  createRule,
  evaluateMeters,
  restartCycle,
  type BillingCycle,
  type MeterCycle,
  type MeterReading,
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

  /**
   * Move rules onto the identities their devices now answer to, and drop one
   * left on a bucket the odometer no longer holds. Two rules landing on one key
   * came from a merge; the first kept is the survivor's.
   */
  resolve(resolveKey: (key: string) => string, exists: (key: string) => boolean): boolean {
    let changed = false;
    const kept: MeterRule[] = [];
    const seen = new Set<string>();
    for (const rule of this.rules) {
      const clientKey = resolveKey(rule.clientKey);
      if (!exists(clientKey) || seen.has(clientKey)) {
        changed = true;
        continue;
      }
      seen.add(clientKey);
      if (clientKey !== rule.clientKey) {
        kept.push({ ...rule, clientKey });
        changed = true;
      } else kept.push(rule);
    }
    if (changed) {
      this.rules = kept;
      this.persist();
    }
    return changed;
  }

  /** Fold one poll's counters through every rule. Persists only when a rule
   *  actually moved, so a poll that changes nothing touches no disk. */
  observe(
    readings: readonly MeterReading[],
    nowMs: number,
    billingCycle?: BillingCycle,
  ): MeterTransition[] {
    const before = this.rules;
    const { rules, transitions } = evaluateMeters(before, readings, nowMs, { billingCycle });
    this.rules = rules;
    if (transitions.length > 0 || rules.some((rule, index) => rule !== before[index]))
      this.persist();
    return transitions;
  }

  /** Record how a pause write went, so a limit that could not be enforced is not
   *  shown as one that was. */
  notePauseState(clientKey: string, state: MeterRule["pauseState"], atMs: number): void {
    const rule = this.find(clientKey);
    if (!rule || rule.pauseState === state) return;
    rule.pauseState = state;
    rule.pauseCheckedMs = atMs;
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
    billingCycle?: BillingCycle;
  }): MeterRule {
    const existing = this.find(options.clientKey);
    // Editing keeps the cycle it is in, so raising a limit mid-cycle hands out no
    // fresh allowance. Changing the cycle kind restarts it: the old boundaries
    // describe nothing.
    const rule =
      existing && existing.cycle.kind === options.cycle.kind
        ? {
            ...existing,
            allocationBytes: options.allocationBytes,
            autoPause: options.autoPause ?? existing.autoPause,
            cycle: options.cycle,
          }
        : createRule(options);
    this.rules = [...this.rules.filter((other) => other.clientKey !== options.clientKey), rule];
    this.persist();
    return rule;
  }

  /** Start a rule's allowance over: a top-up, and what resetting a device's
   *  usage means for the rule reading that counter. */
  restart(clientKey: string, nowMs: number, billingCycle?: BillingCycle): MeterRule | undefined {
    const rule = this.find(clientKey);
    if (!rule) return undefined;
    const restarted = restartCycle(rule, nowMs, billingCycle);
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
