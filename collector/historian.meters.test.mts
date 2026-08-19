// The recorder's metering routes, driven through handleRequest against a real
// data directory.
//
// The module claims a data directory and starts its poll timers when it is
// evaluated, which is why nothing here had a test before. Both are steerable:
// HISTORIAN_DATA_DIR moves the claim to a temp directory, HISTORIAN_EMBED keeps
// the HTTP port shut, and fake timers installed before the import mean none of
// the intervals it registers ever fire.

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const DATA_DIR = mkdtempSync(join(tmpdir(), "historian-meters-"));
const ALERTS_FILE = join(DATA_DIR, "alerts.ndjson");
const NOW = Date.now();
const KEY = "111";

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
    ],
  }),
);
writeFileSync(
  ALERTS_FILE,
  `${JSON.stringify({ source: "system", key: `dataLimit:${KEY}`, startMs: NOW - 1_000, endMs: null })}\n`,
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

  it("leaves nothing behind for a rule that was never there", async () => {
    const before = episodes().length;
    const { body } = await call("DELETE", "/api/clients/meters?client=does-not-exist");
    expect(JSON.parse(body).removed).toBe(false);
    expect(episodes()).toHaveLength(before);
  });
});
