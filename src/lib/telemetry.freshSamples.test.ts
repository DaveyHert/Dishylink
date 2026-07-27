// selectFreshSamples is the shared, pure definition of "which samples in this
// poll's window haven't been recorded yet". It is what lets a long-lived loop and
// an alarm that re-reads the same window agree, so these tests pin the three ways
// it must not misbehave: never lose a sample, never take one twice, and survive a
// reboot that runs the dish's counter backwards.

import { describe, it, expect } from "vitest";
import { selectFreshSamples, type SampleCursor } from "@core/telemetry";
import type { TelemetrySample } from "@core/telemetry";

/** A window of `count` samples ending at `endMs`, whose newest sits at absolute
 *  counter `newestCounter` — the shape decodeHistoryWindow returns. */
function window(newestCounter: number, count: number, endMs: number) {
  const samples: TelemetrySample[] = Array.from({ length: count }, (_, index) => ({
    timestampMs: endMs - (count - 1 - index) * 1000,
    latencyMs: 20,
    dropRate: 0,
    downlinkBps: 0,
    uplinkBps: 0,
    powerW: 30,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  }));
  return { samples, newestCounter };
}

const NOW = 1_700_000_000_000;

describe("selectFreshSamples", () => {
  it("takes the whole window when nothing has been recorded yet", () => {
    const cursor: SampleCursor = { counter: 0, newestSampleMs: 0 };
    expect(selectFreshSamples(window(300, 300, NOW), cursor)).toHaveLength(300);
  });

  it("takes only the samples past the counter on a normal poll", () => {
    // Recorded through counter 300; the window now peaks at 305 → five new.
    const cursor: SampleCursor = { counter: 300, newestSampleMs: NOW - 5000 };
    const fresh = selectFreshSamples(window(305, 300, NOW), cursor);
    expect(fresh).toHaveLength(5);
    expect(fresh[fresh.length - 1].timestampMs).toBe(NOW);
  });

  it("takes nothing when re-draining the same window (idempotent, no double count)", () => {
    // Cursor already at the window's newest counter: a repeat poll adds nothing.
    const cursor: SampleCursor = { counter: 305, newestSampleMs: NOW };
    expect(selectFreshSamples(window(305, 300, NOW), cursor)).toHaveLength(0);
  });

  it("loses nothing across a gap larger than one window", () => {
    // 40 samples advanced but the window only holds 30: it can only offer what it
    // still has, and offers all of it rather than dropping the overlap.
    const cursor: SampleCursor = { counter: 300, newestSampleMs: NOW - 40_000 };
    expect(selectFreshSamples(window(340, 30, NOW), cursor)).toHaveLength(30);
  });

  it("falls back to timestamp when a reboot runs the counter backwards", () => {
    // Held through counter 900 at time T; the dish rebooted and its counter
    // restarted at 5. Only samples newer by clock than what we hold are new.
    const heldMs = NOW - 10_000;
    const cursor: SampleCursor = { counter: 900, newestSampleMs: heldMs };
    const fresh = selectFreshSamples(window(5, 5, NOW), cursor);
    // Window spans NOW-4000..NOW; only those past heldMs+500 count.
    expect(fresh.every((sample) => sample.timestampMs > heldMs + 500)).toBe(true);
    expect(fresh).toHaveLength(5);
  });

  it("falls back to timestamp for a seeded buffer that has no counter", () => {
    // Restored from a snapshot: samples held (newestSampleMs set) but counter
    // unknown (0). The window overlaps the seed's tail; only its newer half is new.
    const seedNewestMs = NOW - 3000;
    const cursor: SampleCursor = { counter: 0, newestSampleMs: seedNewestMs };
    const fresh = selectFreshSamples(window(500, 6, NOW), cursor);
    expect(fresh.every((sample) => sample.timestampMs > seedNewestMs + 500)).toBe(true);
    expect(fresh.some((sample) => sample.timestampMs <= seedNewestMs)).toBe(false);
  });

  it("returns nothing for an empty window", () => {
    expect(selectFreshSamples(window(0, 0, NOW), { counter: 10, newestSampleMs: NOW })).toEqual([]);
  });
});
