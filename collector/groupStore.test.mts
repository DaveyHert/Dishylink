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

describe("minting a group's id", () => {
  /** Every group written on one clock reading — two windows saving together, or a
   *  test that runs faster than a millisecond. */
  const atOneInstant = (groups: DeviceGroupStore, count: number) => {
    const nowMs = Date.now();
    return Array.from({ length: count }, (_, index) =>
      groups.upsert({
        name: `Group ${index}`,
        memberKeys: [`${index}`],
        allocationBytes: GB,
        autoPause: true,
        cycle: { kind: "monthly", day: 1 },
        mode: "perMember",
        nowMs,
      }),
    );
  };

  it("given: groups written in one millisecond, should: give each its own id", () => {
    // The clock alone collides here, and upsert replaces by id: the second group
    // would silently take the first's place, carrying its members' rules off with
    // it.
    const groups = store();
    const written = atOneInstant(groups, 5);

    expect(new Set(written.map((group) => group.groupId)).size).toBe(5);
    expect(groups.all()).toHaveLength(5);
  });

  it("given: an id from the wire naming no group here, should: mint one instead", () => {
    // Ids are the store's to hand out. Taking one from a caller lets it choose a
    // key — including one a later group would then collide with.
    const groups = store();
    const written = groups.upsert({
      groupId: "group-chosen-elsewhere",
      name: "Kids",
      memberKeys: ["111"],
      allocationBytes: GB,
      autoPause: true,
      cycle: { kind: "monthly", day: 1 },
      mode: "perMember",
      nowMs: Date.now(),
    });

    expect(written.groupId).not.toBe("group-chosen-elsewhere");
    expect(written.groupId.startsWith("group-")).toBe(true);
  });

  it("given: an id this store did hand out, should: edit that group rather than add one", () => {
    const groups = store();
    const first = add(groups, ["111"]);

    const edited = groups.upsert({
      groupId: first.groupId,
      name: "Renamed",
      memberKeys: ["111", "222"],
      allocationBytes: 2 * GB,
      autoPause: true,
      cycle: { kind: "monthly", day: 1 },
      mode: "perMember",
      nowMs: Date.now(),
    });

    expect(edited.groupId).toBe(first.groupId);
    expect(groups.all()).toHaveLength(1);
    expect(groups.all()[0]!.name).toBe("Renamed");
  });

  it("given: a group edited later, should: keep its original creation time", () => {
    const groups = store();
    const createdAt = Date.now();
    const first = groups.upsert({
      name: "Kids",
      memberKeys: ["111"],
      allocationBytes: 10 * GB,
      autoPause: true,
      cycle: { kind: "monthly", day: 1 },
      mode: "perMember",
      nowMs: createdAt,
    });

    const edited = groups.upsert({
      groupId: first.groupId,
      name: "Renamed",
      memberKeys: ["111"],
      allocationBytes: 20 * GB,
      autoPause: true,
      cycle: { kind: "monthly", day: 1 },
      mode: "perMember",
      nowMs: createdAt + 60_000,
    });

    expect(edited.createdMs).toBe(createdAt);
    expect(edited.updatedMs).toBe(createdAt + 60_000);
  });

  it("given: a group edited out of order, should: leave it where it already sat rather than moving it to the end", () => {
    const groups = store();
    const first = add(groups, ["111"], "First");
    add(groups, ["222"], "Second");
    add(groups, ["333"], "Third");

    groups.upsert({
      groupId: first.groupId,
      name: "First, renamed",
      memberKeys: ["111"],
      allocationBytes: 5 * GB,
      autoPause: true,
      cycle: { kind: "monthly", day: 1 },
      mode: "perMember",
      nowMs: Date.now(),
    });

    expect(groups.all().map((group) => group.name)).toEqual(["First, renamed", "Second", "Third"]);
  });
});

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
