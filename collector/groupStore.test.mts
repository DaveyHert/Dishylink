// The group store's reconciliation, against a real file.
//
// What matters here is that a group which can no longer cover anything actually
// goes: a stale one is projected back into rules on the next poll, so the rule
// store drops them and the projection writes them again, every poll, for ever.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceGroupStore } from "./groupStore.mts";

const GB = 1_000_000_000;

function store(): DeviceGroupStore {
  return new DeviceGroupStore(join(mkdtempSync(join(tmpdir(), "group-store-")), "groups.json"));
}

function add(groups: DeviceGroupStore, memberKeys: string[], name = "Kids") {
  return groups.upsert({
    name,
    memberKeys,
    allocationBytes: 10 * GB,
    autoPause: true,
    cycle: { kind: "monthly", day: 1 },
    mode: "perMember",
    nowMs: Date.now(),
  });
}

const roster = (keys: string[]) => ({ keys, resolveKey: (key: string) => key });

describe("resolving a group against the roster", () => {
  it("given: its last member gone, should: drop the group", () => {
    const groups = store();
    add(groups, ["gone"]);
    groups.resolve(roster(["someone-else"]));
    expect(groups.all()).toEqual([]);
  });

  it("given: the only group dropped, should: report the change and persist it", () => {
    const groups = store();
    add(groups, ["gone"]);
    // The list shrinks to empty, which an index-by-index comparison reads as
    // unchanged — so the drop was decided and then never written.
    expect(groups.resolve(roster(["someone-else"]))).toBe(true);
    expect(groups.all()).toEqual([]);
  });

  it("given: a surviving group after a dropped one, should: keep only the survivor", () => {
    const groups = store();
    add(groups, ["gone"], "First");
    add(groups, ["alive"], "Second");
    groups.resolve(roster(["alive"]));
    expect(groups.all().map((group) => group.name)).toEqual(["Second"]);
  });

  it("given: an empty roster, should: drop nobody", () => {
    const groups = store();
    add(groups, ["a"]);
    groups.resolve(roster([]));
    expect(groups.all()).toHaveLength(1);
  });
});

describe("removing a member", () => {
  it("given: the group's last member, should: take the group with it", () => {
    const groups = store();
    add(groups, ["a"]);
    expect(groups.removeMember("a")).toBe(true);
    expect(groups.all()).toEqual([]);
  });

  it("given: one of several, should: keep the group", () => {
    const groups = store();
    add(groups, ["a", "b"]);
    groups.removeMember("a");
    expect(groups.all()[0]!.memberKeys).toEqual(["b"]);
  });

  it("given: a device in no group, should: change nothing", () => {
    const groups = store();
    add(groups, ["a"]);
    expect(groups.removeMember("z")).toBe(false);
    expect(groups.all()).toHaveLength(1);
  });
});
