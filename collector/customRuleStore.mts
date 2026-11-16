// Persistence for user-defined threshold alert rules.
//
// Rules are a small JSON file — not NDJSON like time-series data — because the
// full set is always read and written together and no history is kept. Writes
// go through an atomic rename so the reader never sees a partial file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CustomAlertRule } from "../core/customAlertRules.ts";

interface Snapshot {
  version: 1;
  rules: CustomAlertRule[];
}

export class CustomRuleStore {
  private rules: CustomAlertRule[] = [];

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Snapshot;
      if (Array.isArray(raw.rules)) {
        this.rules = raw.rules.filter(isValidRule);
      }
    } catch {
      // Corrupt or missing — start empty. The next write will fix it.
    }
  }

  all(): CustomAlertRule[] {
    return this.rules;
  }

  upsert(rule: CustomAlertRule): void {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    this.snapshot();
  }

  remove(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length !== before) {
      this.snapshot();
      return true;
    }
    return false;
  }

  replaceAll(rules: CustomAlertRule[]): void {
    this.rules = rules.filter(isValidRule);
    this.snapshot();
  }

  private snapshot(): void {
    const tmp = `${this.path}.tmp`;
    const data: Snapshot = { version: 1, rules: this.rules };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }
}

function isValidRule(r: unknown): r is CustomAlertRule {
  if (typeof r !== "object" || r === null) return false;
  const rule = r as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    typeof rule.name === "string" &&
    typeof rule.metric === "string" &&
    (rule.condition === "above" || rule.condition === "below") &&
    typeof rule.threshold === "number" &&
    typeof rule.durationSeconds === "number" &&
    typeof rule.enabled === "boolean"
  );
}
