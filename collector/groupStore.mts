// The desktop's device groups: the shared group model with an fs snapshot behind
// it, alongside the rule store the groups project into.
//
// Membership lives here rather than being read back off the projected rules, so a
// pooled allowance is always divided across the devices the user named.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  newGroupId,
  resolveGroupMembers,
  type DeviceGroup,
  type GroupAllowanceMode,
} from "../core/deviceGroup.ts";
import { listChanged, type MeterCycle, type MeterRoster } from "../core/dataMeter.ts";
import type { Schedule } from "../core/schedule.ts";

const VERSION = 1;

interface Snapshot {
  version: typeof VERSION;
  groups: DeviceGroup[];
}

export class DeviceGroupStore {
  private groups: DeviceGroup[] = [];

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.restore();
  }

  private restore(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const stored = JSON.parse(readFileSync(this.filePath, "utf8")) as Snapshot;
      if (stored?.version === VERSION && Array.isArray(stored.groups)) this.groups = stored.groups;
    } catch {
      // unreadable snapshot: start with no groups rather than refuse to boot
    }
  }

  private persist(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(
        tempPath,
        JSON.stringify({ version: VERSION, groups: this.groups } as Snapshot),
      );
      renameSync(tempPath, this.filePath);
    } catch {
      // a failed write costs the group change on a restart, not the recorder
    }
  }

  all(): DeviceGroup[] {
    return this.groups;
  }

  find(groupId: string): DeviceGroup | undefined {
    return this.groups.find((group) => group.groupId === groupId);
  }

  /** Reconcile membership against the odometer's roster. True when any moved. */
  resolve(roster: MeterRoster): boolean {
    const resolved = resolveGroupMembers(this.groups, roster);
    const changed = listChanged(resolved, this.groups);
    if (changed) {
      this.groups = resolved;
      this.persist();
    }
    return changed;
  }

  upsert(options: {
    groupId?: string;
    name: string;
    memberKeys: string[];
    allocationBytes: number;
    autoPause: boolean;
    cycle: MeterCycle;
    mode: GroupAllowanceMode;
    countdownMs?: number;
    schedule?: Schedule;
    nowMs: number;
  }): DeviceGroup {
    const existing = options.groupId ? this.find(options.groupId) : undefined;
    const group: DeviceGroup = {
      // A write naming a group this store does not hold is a new group, not that
      // id: ids are this store's to mint, and honouring one from the wire lets a
      // caller land on a key it chose — including one a later group would collide
      // with.
      groupId: existing?.groupId ?? newGroupId(this.groups, options.nowMs),
      name: options.name,
      memberKeys: [...new Set(options.memberKeys)],
      allocationBytes: options.allocationBytes,
      autoPause: options.autoPause,
      // A countdown runs from its own start, so the cycle it is written on is one
      // that does not move that start under it. Matched to what the projected
      // rules carry, or their terms would read as changed on every poll.
      cycle: options.countdownMs === undefined ? options.cycle : { kind: "once" },
      mode: options.mode,
      updatedMs: options.nowMs,
      createdMs: existing?.createdMs ?? options.nowMs,
      ...(options.countdownMs === undefined ? {} : { countdownMs: options.countdownMs }),
      ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    };
    const index = this.groups.findIndex((other) => other.groupId === group.groupId);
    this.groups =
      index === -1
        ? [...this.groups, group]
        : this.groups.map((other, position) => (position === index ? group : other));
    this.persist();
    return group;
  }

  remove(groupId: string): boolean {
    const kept = this.groups.filter((group) => group.groupId !== groupId);
    if (kept.length === this.groups.length) return false;
    this.groups = kept;
    this.persist();
    return true;
  }

  /**
   * Drop a device from every group it is listed in, for a record being deleted.
   *
   * A group left with no members goes with it: it covers nothing, and keeping it
   * would leave a limit on the list that no device answers to.
   */
  removeMember(clientKey: string): boolean {
    const kept = this.groups
      .map((group) =>
        group.memberKeys.includes(clientKey)
          ? { ...group, memberKeys: group.memberKeys.filter((key) => key !== clientKey) }
          : group,
      )
      .filter((group) => group.memberKeys.length > 0);
    if (!listChanged(kept, this.groups)) return false;
    this.groups = kept;
    this.persist();
    return true;
  }

  clear(): void {
    this.groups = [];
    this.persist();
  }
}
