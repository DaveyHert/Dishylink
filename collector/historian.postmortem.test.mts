// The recorder's post-mortem path, end to end: an open outage episode, the dish
// event and pre-drop samples seeded on disk, a `cleared` transition — and the
// report is written and served, with its numbers folded from the recordings
// around the outage.
//
// Like historian.meters.test.mts: the module claims a data directory and starts
// its poll timers when evaluated, so HISTORIAN_DATA_DIR moves the claim to a
// temp directory, HISTORIAN_EMBED keeps the HTTP port shut, and fake timers
// installed before the import mean none of the intervals it registers fire.

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SYSTEM_ALERTS } from "../core/alertDefinitions.ts";
import type { TelemetrySample } from "../core/telemetry.ts";

const DATA_DIR = mkdtempSync(join(tmpdir(), "historian-postmortem-"));
const POSTMORTEMS_FILE = join(DATA_DIR, "postmortems.ndjson");

const NOW = Date.now();
const START = NOW - 3 * 60_000; // the drop, three minutes ago
const END = NOW; // the close, now
const WINDOW_START = START - 5 * 60_000;

// The recorder's own episode: opened when the drop was detected, still open on
// disk so the engine restores it across the restart this import represents.
writeFileSync(
  join(DATA_DIR, "alerts.ndjson"),
  JSON.stringify({ source: "system", key: "starlinkOutage", startMs: START, endMs: null }) + "\n",
);

// The dish's own event log entry for the same outage, for the cause.
writeFileSync(
  join(DATA_DIR, "events.ndjson"),
  JSON.stringify({
    startMs: START - 2_000,
    durationMs: 182_000,
    cause: "EVENT_REASON_OUTAGE_NO_PINGS",
    severity: "warning",
  }) + "\n",
);

// The 1 s sample window the recorder would be holding: a healthy five minutes
// before the drop (latency 40 ms, 100 Mbps down), snow melt asserted on the
// first half only — enough to answer "was snow melt active?".
function sample(timestampMs: number, snowMelt: boolean | null): TelemetrySample {
  return {
    timestampMs,
    latencyMs: 40,
    dropRate: 0,
    downlinkBps: 100_000_000,
    uplinkBps: 10_000_000,
    powerW: 80,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
    snowMeltActive: snowMelt,
  };
}
const samples: TelemetrySample[] = Array.from({ length: 300 }, (_, second) =>
  sample(WINDOW_START + second * 1000, second < 150 ? true : null),
);
writeFileSync(join(DATA_DIR, "samples.json"), JSON.stringify(samples));

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

describe("the recorder's post-mortem path", () => {
  it("generates a report the moment the outage episode clears, and serves it", async () => {
    historian.recordAlertTransitions([
      {
        kind: "cleared",
        source: "system",
        key: "starlinkOutage",
        atMs: END,
        spec: SYSTEM_ALERTS.starlinkOutage,
      },
    ]);

    const persisted = JSON.parse(readFileSync(POSTMORTEMS_FILE, "utf8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      id: `system:starlinkOutage:${START}`,
      source: "starlinkOutage",
      startMs: START,
      endMs: END,
      durationMs: END - START,
      cause: "NO_PINGS",
    });

    // The five minutes before the drop, from the sample window.
    expect(persisted.beforeDrop).toMatchObject({
      coverageSeconds: 300,
      latencyAvgMs: 40,
      downlinkAvgBps: 100_000_000,
      uplinkAvgBps: 10_000_000,
      snowMelt: "active",
      source: "samples",
    });

    // The episode is closed on disk too — a report is only ever generated
    // against the recording that saw the outage end.
    const episodes = readFileSync(join(DATA_DIR, "alerts.ndjson"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ source: "system", key: "starlinkOutage", endMs: END });

    const { status, body } = await call("GET", "/api/outages/reports");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      reports: [{ id: `system:starlinkOutage:${START}` }],
    });
  });

  it("will not regenerate a report for the same episode", () => {
    historian.recordAlertTransitions([
      {
        kind: "cleared",
        source: "system",
        key: "starlinkOutage",
        atMs: END,
        spec: SYSTEM_ALERTS.starlinkOutage,
      },
    ]);
    expect(readFileSync(POSTMORTEMS_FILE, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("ignores a thermal episode clearing — heat is report content, not a report trigger", async () => {
    const before = readFileSync(POSTMORTEMS_FILE, "utf8").trim().split("\n").length;
    historian.recordAlertTransitions([
      {
        kind: "cleared",
        source: "dish",
        key: "thermalThrottle",
        atMs: END,
        spec: SYSTEM_ALERTS.starlinkOutage,
      },
    ]);
    const { body } = await call("GET", "/api/outages/reports");
    expect((JSON.parse(body) as { reports: unknown[] }).reports).toHaveLength(before);
  });

  it("still reports an outage whose episode started outside the 48 h alert window", () => {
    // The episode is long (started yesterday), so it has aged out of the alert
    // log's served window by the time it clears — the report must not depend on
    // `AlertStore.all()` for the episode lookup.
    const oldStart = END - 49 * 3_600_000;
    historian.recordAlertTransitions([
      {
        kind: "fired",
        source: "system",
        key: "dishUnreachable",
        atMs: oldStart,
        spec: SYSTEM_ALERTS.dishUnreachable,
      },
    ]);
    historian.recordAlertTransitions([
      {
        kind: "cleared",
        source: "system",
        key: "dishUnreachable",
        atMs: END,
        spec: SYSTEM_ALERTS.dishUnreachable,
      },
    ]);

    const rows = readFileSync(POSTMORTEMS_FILE, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(2); // the seeded outage plus this one
    const report = rows.find((row) => row.id === `system:dishUnreachable:${oldStart}`);
    expect(report).toMatchObject({
      source: "dishUnreachable",
      startMs: oldStart,
      endMs: END,
      durationMs: END - oldStart,
    });
    // The pre-drop window has no samples or minute rows this far back: the
    // honest zero-invention fallback, not a swallowed report.
    expect(report!.beforeDrop).toMatchObject({
      coverageSeconds: 0,
      latencyAvgMs: null,
      source: "minute-buckets",
    });
  });
});
