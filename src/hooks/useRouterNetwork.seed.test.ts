// The seed hands the chart thirty minutes of history in one request; the tail
// then appends a second at a time. The join between them is the whole risk.
//
// It went wrong once already: the seed populated the series but reported nothing
// about how far it reached, so the first tail asked from zero, was handed the
// same window back, and appended a duplicate of every point. Identical
// timestamps meant the chart looked correct while holding two of everything.
//
// So what is asserted here is the handoff value, not the fetch: `newestSampleMs`
// must be the newest sample the seed actually holds. Paired with the
// `ClientWindow.samples since` tests on the historian side — which prove the
// boundary sample is excluded rather than resent — that closes the loop.

import { afterEach, describe, expect, it, vi } from "vitest";
import { appendClientSamples, fetchPersistedClientHistory } from "./useRouterNetwork";
import type { TelemetrySample } from "@core/telemetry";

const MAC = "aa:bb:cc:dd:ee:ff";

function stubHistorian(payload: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => payload })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPersistedClientHistory", () => {
  it("reports the newest sample it holds, so the first tail resumes past it", async () => {
    stubHistorian({
      samples: [
        { key: MAC, macAddress: MAC, atMs: 1_000, downMbps: 1, upMbps: 0.1 },
        { key: MAC, macAddress: MAC, atMs: 3_000, downMbps: 3, upMbps: 0.3 },
        { key: MAC, macAddress: MAC, atMs: 2_000, downMbps: 2, upMbps: 0.2 },
      ],
    });

    const { history, newestSampleMs } = await fetchPersistedClientHistory();

    expect(newestSampleMs).toBe(3_000);
    // and the series it seeded actually ends there — the two must agree, or the
    // tail resumes from a point the chart does not hold.
    const series = history.get(MAC)!;
    expect(series[series.length - 1].timestampMs).toBe(3_000);
  });

  it("takes the newest across devices, since one `since` covers the whole tail", async () => {
    stubHistorian({
      samples: [
        { macAddress: "aa:aa:aa:aa:aa:aa", atMs: 5_000, downMbps: 1, upMbps: 0 },
        { macAddress: "bb:bb:bb:bb:bb:bb", atMs: 9_000, downMbps: 2, upMbps: 0 },
      ],
    });

    expect((await fetchPersistedClientHistory()).newestSampleMs).toBe(9_000);
  });

  it("reports zero when the historian has no raw samples, so the tail asks for the window", async () => {
    // Per-minute rows only — the state just after a historian restart. Those are
    // not tail-able, so the tail must start from the full window, not from a
    // minute boundary that would skip the raw samples recorded since.
    stubHistorian({
      history: [{ minute: 60, key: MAC, macAddress: MAC, downMbps: 4, upMbps: 1 }],
      samples: [],
    });

    const { history, newestSampleMs } = await fetchPersistedClientHistory();

    expect(newestSampleMs).toBe(0);
    expect(history.get(MAC)).toHaveLength(1);
  });

  it("reports zero when the historian is down, rather than skipping the tail forward", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const { history, newestSampleMs } = await fetchPersistedClientHistory();

    expect(newestSampleMs).toBe(0);
    expect(history.size).toBe(0);
  });

  it("reports zero on a non-ok response", async () => {
    stubHistorian({}, false);

    expect((await fetchPersistedClientHistory()).newestSampleMs).toBe(0);
  });
});

// The chart froze once: the tail appended with `series.push` in place, so
// `throughputHistory.get(mac)` handed back the same array every second. The
// hook signals change by shallow-copying the Map, not the arrays, so the
// per-device chart's `useMemo(windowTail, [history])` never saw a new reference
// and only advanced when the panel was remounted. What must hold is identity:
// an appended-to series is a NEW array; an untouched one is not.
describe("appendClientSamples", () => {
  it("replaces a touched series with a new array reference", () => {
    const history = new Map<string, TelemetrySample[]>();
    const before = appendClientSamples(history, [
      { key: MAC, macAddress: MAC, atMs: 1_000, downMbps: 1, upMbps: 0.1 },
    ]);
    const firstRef = history.get(MAC)!;
    expect(before).toBe(1_000);

    appendClientSamples(history, [
      { key: MAC, macAddress: MAC, atMs: 2_000, downMbps: 2, upMbps: 0.2 },
    ]);
    const secondRef = history.get(MAC)!;

    // A new reference is the whole fix — the memo downstream keys on it.
    expect(secondRef).not.toBe(firstRef);
    expect(secondRef.map((sample) => sample.timestampMs)).toEqual([1_000, 2_000]);
  });

  it("leaves an untouched device's array reference alone", () => {
    const history = new Map<string, TelemetrySample[]>();
    appendClientSamples(history, [
      { key: "other", macAddress: "other", atMs: 1_000, downMbps: 1, upMbps: 0 },
    ]);
    const untouchedRef = history.get("other")!;

    appendClientSamples(history, [
      { key: MAC, macAddress: MAC, atMs: 2_000, downMbps: 2, upMbps: 0 },
    ]);

    expect(history.get("other")!).toBe(untouchedRef);
  });

  it("appends both samples to one fresh array when a batch repeats a MAC", () => {
    const history = new Map<string, TelemetrySample[]>([
      [
        MAC,
        [
          {
            timestampMs: 0,
            latencyMs: null,
            dropRate: 0,
            downlinkBps: 0,
            uplinkBps: 0,
            powerW: 0,
            routerLatencyMs: null,
            routerPingSuccessPercent: null,
          },
        ],
      ],
    ]);
    const originalRef = history.get(MAC)!;
    const newestMs = appendClientSamples(history, [
      { key: MAC, macAddress: MAC, atMs: 1_000, downMbps: 1, upMbps: 0 },
      { key: MAC, macAddress: MAC, atMs: 2_000, downMbps: 2, upMbps: 0 },
    ]);

    expect(newestMs).toBe(2_000);
    // One copy for the batch, both new points on it, seed point kept, and the
    // in-place seed array is never mutated.
    expect(history.get(MAC)!).not.toBe(originalRef);
    expect(history.get(MAC)!.map((sample) => sample.timestampMs)).toEqual([0, 1_000, 2_000]);
    expect(originalRef.map((sample) => sample.timestampMs)).toEqual([0]);
  });
});
