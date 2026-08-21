// The recorder's metering routes, driven through handleRequest against a real
// data directory.
//
// The module claims a data directory and starts its poll timers when it is
// evaluated, which is why nothing here had a test before. Both are steerable:
// HISTORIAN_DATA_DIR moves the claim to a temp directory, HISTORIAN_EMBED keeps
// the HTTP port shut, and fake timers installed before the import mean none of
// the intervals it registers ever fire.
//
// Everything that drives the recorder this way lives in this one file. The
// directory is named through process.env, which is process-wide, so a second file
// setting it can land between this one's assignment and its import.

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeterRule } from "../core/dataMeter.ts";

const DATA_DIR = mkdtempSync(join(tmpdir(), "historian-meters-"));
const ALERTS_FILE = join(DATA_DIR, "alerts.ndjson");
const NOW = Date.now();
const KEY = "111";
const GROUP = "kids";
const GROUP_ALERT = `dataLimit:group:${GROUP}`;
const MEMBERS = ["333", "444"];

/** A member of a shared allowance, over it between them rather than alone. */
function member(clientKey: string) {
  return {
    clientKey,
    allocationBytes: 10_000_000_000,
    autoPause: true,
    cycle: { kind: "daily" },
    anchorRx: 0,
    anchorTx: 0,
    observedRx: 6_000_000_000,
    observedTx: 0,
    periodStartMs: NOW - 1_000,
    periodEndMs: NOW + 86_400_000,
    actedThisCycle: true,
    pauseState: "none",
    reachedAtMs: NOW - 1_000,
    groupId: GROUP,
    sharedAllowance: true,
  };
}

writeFileSync(
  join(DATA_DIR, "device-groups.json"),
  JSON.stringify({
    version: 1,
    groups: [
      {
        groupId: GROUP,
        name: "Kids",
        memberKeys: MEMBERS,
        allocationBytes: 10_000_000_000,
        autoPause: true,
        cycle: { kind: "daily" },
        mode: "pooled",
        updatedMs: NOW - 1_000,
      },
    ],
  }),
);

/** Seeded before the import, because both stores read their file as the module
 *  is evaluated: a rule whose announcement is still standing, and the open
 *  episode that announcement opened. */
writeFileSync(
  join(DATA_DIR, "meters.json"),
  JSON.stringify({
    version: 1,
    rules: [
      {
        clientKey: KEY,
        allocationBytes: 10_000_000_000,
        autoPause: true,
        cycle: { kind: "daily" },
        anchorRx: 0,
        anchorTx: 0,
        observedRx: 20_000_000_000,
        observedTx: 0,
        periodStartMs: NOW - 1_000,
        periodEndMs: NOW + 86_400_000,
        actedThisCycle: true,
        pauseState: "failed",
        reachedAtMs: NOW - 1_000,
      },
      ...MEMBERS.map(member),
    ],
  }),
);
writeFileSync(
  ALERTS_FILE,
  [
    JSON.stringify({
      source: "system",
      key: `dataLimit:${KEY}`,
      startMs: NOW - 1_000,
      endMs: null,
    }),
    // One episode for the whole shared allowance, which is how it was announced.
    JSON.stringify({ source: "system", key: GROUP_ALERT, startMs: NOW - 1_000, endMs: null }),
  ].join("\n") + "\n",
);

process.env.HISTORIAN_DATA_DIR = DATA_DIR;
process.env.HISTORIAN_EMBED = "1";

vi.useFakeTimers();
const historian = await import("./historian.mts");

function call(method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    const response = {
      statusCode: 200,
      setHeader() {},
      write(chunk: string) {
        chunks.push(chunk);
      },
      end(body?: string) {
        if (body) chunks.push(body);
        resolve({ status: response.statusCode, body: chunks.join("") });
      },
    };
    historian.handleRequest(
      { url: path, method, headers: {} } as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });
}

function episodes(): { key: string; endMs: number | null }[] {
  return readFileSync(ALERTS_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("the recorder's meter routes", () => {
  it("serves the rule it restored, with what it has counted", async () => {
    const { status, body } = await call("GET", "/api/clients/meters");
    expect(status).toBe(200);
    const rule = JSON.parse(body).rules[0];
    expect(rule.clientKey).toBe(KEY);
    expect(rule.allocationBytes).toBe(10_000_000_000);
    expect(rule.usageBytes).toBe(20_000_000_000);
  });

  it("retires the announcement when the rule behind it is deleted", async () => {
    // Nothing else can: expiry runs off the rule's own stamp, and the delete
    // takes the stamp with it. An episode left open outlives the retention sweep.
    expect(episodes().find((e) => e.key === `dataLimit:${KEY}`)?.endMs).toBeNull();

    const { status, body } = await call("DELETE", `/api/clients/meters?client=${KEY}`);

    expect(status).toBe(200);
    expect(JSON.parse(body).removed).toBe(true);
    expect(episodes().find((e) => e.key === `dataLimit:${KEY}`)?.endMs).toEqual(expect.any(Number));
  });

  it("drops only a device's own rule when the write says so", async () => {
    // The rules list deletes one of the several rules a device can answer to.
    // Without the scope the device leaves every group naming it, taking a limit
    // set over other devices with it.
    const member = MEMBERS[0];
    await call("POST", `/api/clients/meters?client=${member}&allocation=1000000000&cycle=daily`);
    const dropped = await call("DELETE", `/api/clients/meters?client=${member}&scope=own`);
    expect(JSON.parse(dropped.body).removed).toBe(true);

    const left = await call("GET", `/api/clients/meters?client=${member}`);
    expect(JSON.parse(left.body).rules.map((rule: MeterRule) => rule.groupId)).toEqual([GROUP]);
    const groups = await call("GET", "/api/clients/groups");
    expect(JSON.parse(groups.body).groups[0].memberKeys).toContain(member);
  });

  it("leaves nothing behind for a rule that was never there", async () => {
    const before = episodes().length;
    const { body } = await call("DELETE", "/api/clients/meters?client=does-not-exist");
    expect(JSON.parse(body).removed).toBe(false);
    expect(episodes()).toHaveLength(before);
  });
});

describe("the recorder's group routes", () => {
  it("serves the groups it holds", async () => {
    const { status, body } = await call("GET", "/api/clients/groups");
    expect(status).toBe(200);
    const [group] = JSON.parse(body).groups;
    expect(group.groupId).toBe(GROUP);
    expect(group.memberKeys).toEqual(MEMBERS);
  });

  it("charges each member of a shared allowance what the group has spent", async () => {
    const { body } = await call("GET", "/api/clients/meters");
    const rules = JSON.parse(body).rules as { clientKey: string; usageBytes: number }[];
    // Neither member is over 10 GB alone; together they are, and a card drawing
    // either one against the allowance has to read the sum or call it under.
    for (const key of MEMBERS)
      expect(rules.find((rule) => rule.clientKey === key)?.usageBytes).toBe(12_000_000_000);
  });

  it("names the group on a member's rule, so the card knows what set it", async () => {
    const { body } = await call("GET", `/api/clients/meters?client=${MEMBERS[0]}`);
    expect(JSON.parse(body).rules[0].groupName).toBe("Kids");
  });

  it("retires the group's announcement under the group's own key when it is deleted", async () => {
    expect(episodes().find((episode) => episode.key === GROUP_ALERT)?.endMs).toBeNull();

    const { status, body } = await call("DELETE", `/api/clients/groups?group=${GROUP}`);

    expect(status).toBe(200);
    expect(JSON.parse(body).removed).toBe(true);
    // Under the group. Resolving the name after the group is gone files this
    // under a device instead and leaves the group's episode open for ever.
    expect(episodes().find((episode) => episode.key === GROUP_ALERT)?.endMs).toEqual(
      expect.any(Number),
    );
    // And once, not once per member.
    for (const key of MEMBERS)
      expect(episodes().some((episode) => episode.key === `dataLimit:${key}`)).toBe(false);
  });

  it("leaves nothing behind for a group that was never there", async () => {
    const before = episodes().length;
    const { body } = await call("DELETE", "/api/clients/groups?group=does-not-exist");
    expect(JSON.parse(body).removed).toBe(false);
    expect(episodes()).toHaveLength(before);
  });

  it("words a one-member group's announcement as the extension does", async () => {
    // A timer over one device is a group as far as the rules go, but there is
    // nobody else to speak for. Worded as a plural here and a singular on the
    // other recorder, one announcement reads back from history as two events.
    const write = await call(
      "POST",
      `/api/clients/groups?name=${encodeURIComponent("My phone use")}&members=999&allocation=0&cycle=once&countdown=1800000`,
    );
    expect(write.status).toBe(200);

    const { body } = await call("GET", "/api/clients/meters?client=999");
    const [rule] = JSON.parse(body).rules;
    // The rule announces for its group, and the group covers this device alone.
    expect(rule.groupId).toBeDefined();
    expect(rule.groupName).toBeUndefined();
  });
});

describe("the recorder's schedule parameter", () => {
  const SCHEDULED = "555";
  const HOURS = "allow;12345@960-1200;06@540-1260";

  it("takes a timetable with no allowance behind it, and hands it back", async () => {
    const write = await call(
      "POST",
      `/api/clients/meters?client=${SCHEDULED}&allocation=0&cycle=monthly&day=1&schedule=${encodeURIComponent(HOURS)}`,
    );
    expect(write.status).toBe(200);

    const { body } = await call("GET", `/api/clients/meters?client=${SCHEDULED}`);
    const [rule] = JSON.parse(body).rules;
    expect(rule.schedule).toEqual({
      mode: "allow",
      windows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 960, endMinute: 1200 },
        { weekdays: [0, 6], startMinute: 540, endMinute: 1260 },
      ],
    });
    // Worked out on the write, so the first poll after it can act on the hours.
    expect(typeof rule.windowEndMs).toBe("number");
    expect(Number.isFinite(rule.windowEndMs)).toBe(true);
  });

  it("still refuses a rule that measures nothing at all", async () => {
    const { status } = await call(
      "POST",
      "/api/clients/meters?client=666&allocation=0&cycle=daily",
    );
    expect(status).toBe(400);
  });

  it("puts a group's timetable on its members", async () => {
    const write = await call(
      "POST",
      `/api/clients/groups?name=Kids&members=777,888&allocation=0&cycle=daily&schedule=${encodeURIComponent("block;0123456@1320-420")}`,
    );
    expect(write.status).toBe(200);

    const { body } = await call("GET", "/api/clients/meters?client=888");
    expect(JSON.parse(body).rules[0].schedule.mode).toBe("block");
  });
});
