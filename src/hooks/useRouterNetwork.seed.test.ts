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
// `ClientWindow.samples since` tests on the collector side — which prove the
// boundary sample is excluded rather than resent — that closes the loop.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPersistedClientHistory } from "./useRouterNetwork";

const MAC = "aa:bb:cc:dd:ee:ff";

function stubCollector(payload: unknown, ok = true): void {
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
    stubCollector({
      samples: [
        { macAddress: MAC, atMs: 1_000, downMbps: 1, upMbps: 0.1 },
        { macAddress: MAC, atMs: 3_000, downMbps: 3, upMbps: 0.3 },
        { macAddress: MAC, atMs: 2_000, downMbps: 2, upMbps: 0.2 },
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
    stubCollector({
      samples: [
        { macAddress: "aa:aa:aa:aa:aa:aa", atMs: 5_000, downMbps: 1, upMbps: 0 },
        { macAddress: "bb:bb:bb:bb:bb:bb", atMs: 9_000, downMbps: 2, upMbps: 0 },
      ],
    });

    expect((await fetchPersistedClientHistory()).newestSampleMs).toBe(9_000);
  });

  it("reports zero when the collector has no raw samples, so the tail asks for the window", async () => {
    // Per-minute rows only — the state just after a collector restart. Those are
    // not tail-able, so the tail must start from the full window, not from a
    // minute boundary that would skip the raw samples recorded since.
    stubCollector({ history: [{ minute: 60, macAddress: MAC, downMbps: 4, upMbps: 1 }], samples: [] });

    const { history, newestSampleMs } = await fetchPersistedClientHistory();

    expect(newestSampleMs).toBe(0);
    expect(history.get(MAC)).toHaveLength(1);
  });

  it("reports zero when the collector is down, rather than skipping the tail forward", async () => {
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
    stubCollector({}, false);

    expect((await fetchPersistedClientHistory()).newestSampleMs).toBe(0);
  });
});
