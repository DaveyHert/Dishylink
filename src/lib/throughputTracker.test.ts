// The tracker reads the router's byte counter, which steps once every ~1005 ms
// rather than changing continuously. It polls faster than that and measures each
// step as it lands, so a rate is one refresh interval of traffic with no
// smoothing window at all.
//
// The two cases that drive the design are pinned first: sampling a 1005 ms
// staircase from a 1 Hz clock aliases into fake dropouts, and a burst that
// follows a stretch of silence must be attributed to the interval it happened
// in rather than divided across the silence. Everything after those is the set
// of situations where a delta would lie and the tracker has to decline.

import { describe, expect, it } from "vitest";
import { ThroughputTracker } from "@core/throughputTracker";

const MAC = "aa:bb:cc:dd:ee:ff";
const FALLBACK = { downMbps: 9, upMbps: 3 };
const T0 = 1_784_400_000_000;

const MB = 1_000_000;
/** Measured on Gen 3 firmware: 23 consecutive intervals of 1001-1011 ms. */
const REFRESH_MS = 1_005;
/** Five polls per step, as the historian runs. */
const POLL_MS = 200;

/** 12.5 MB in one refresh interval ≈ 99.5 Mbps. */
const STEP_BYTES = 12.5 * MB;
const STEP_MBPS = (STEP_BYTES * 8) / 1_000_000 / (REFRESH_MS / 1000);

/**
 * Drive the tracker the way the historian does: a counter that steps on the
 * router's cadence, polled on ours, with the two deliberately unsynchronised.
 * Returns every rate observed after the first step, which is where the old
 * design produced its dropouts.
 */
function runPolling({
  durationMs,
  bytesPerStep,
  startAtMs = T0,
  stepMs = REFRESH_MS,
  pollMs = POLL_MS,
}: {
  durationMs: number;
  bytesPerStep: (stepIndex: number) => number;
  startAtMs?: number;
  stepMs?: number;
  pollMs?: number;
}): number[] {
  const tracker = new ThroughputTracker();
  const observed: number[] = [];
  let counter = 0;
  let stepsApplied = 0;
  // The router's first step lands mid-way through our polling, not aligned to it.
  const firstStepAtMs = startAtMs + 137;

  for (let atMs = startAtMs; atMs <= startAtMs + durationMs; atMs += pollMs) {
    const stepsDue = Math.max(0, Math.floor((atMs - firstStepAtMs) / stepMs) + 1);
    while (stepsApplied < stepsDue) {
      counter += bytesPerStep(stepsApplied);
      stepsApplied++;
    }
    const rates = tracker.rates(MAC, { rxBytes: counter, txBytes: 0 }, atMs, FALLBACK);
    if (stepsApplied > 0) observed.push(rates.downMbps);
  }
  return observed;
}

describe("ThroughputTracker.rates", () => {
  it("measures one counter step as one refresh interval of traffic", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);
    // The step is observed one poll later, but the router accumulated it over
    // its own period — so that period is the divisor, not our 200 ms poll gap.
    const rates = tracker.rates(
      MAC,
      { rxBytes: STEP_BYTES, txBytes: 1.25 * MB },
      T0 + POLL_MS,
      FALLBACK,
    );

    expect(rates.downMbps).toBeCloseTo(STEP_MBPS, 5);
    expect(rates.upMbps).toBeCloseTo((1.25 * MB * 8) / 1_000_000 / (REFRESH_MS / 1000), 5);
  });

  // The regression that motivated edge detection. A 1 Hz sampler drifting against
  // a 1005 ms step lands twice inside one step and not at all inside the next,
  // reporting a dropout to near zero mid-transfer followed by a doubled spike.
  // Polling faster and measuring the edge removes the mechanism entirely.
  it("reports a steady transfer as steady, with no aliased dropouts", () => {
    const observed = runPolling({ durationMs: 30_000, bytesPerStep: () => STEP_BYTES });

    expect(observed.length).toBeGreaterThan(100);
    for (const rate of observed) expect(rate).toBeCloseTo(STEP_MBPS, 5);
  });

  it("holds the measured rate between steps instead of blinking to zero", () => {
    // Four of every five polls fall between edges. Those must report the last
    // completed interval, not "no traffic since the last poll".
    const observed = runPolling({ durationMs: 5_000, bytesPerStep: () => STEP_BYTES });

    expect(observed.every((rate) => rate > 0)).toBe(true);
  });

  // The bug the obvious formula walks into: deriving the interval count from the
  // time since the counter last *moved* would divide this burst by the nine
  // seconds since the device went quiet, reporting an eighth of the real rate.
  it("attributes a burst after a long idle to the interval it happened in", () => {
    const idleSteps = 8;
    const burstBytes = 10 * MB;
    const observed = runPolling({
      durationMs: 12_000,
      bytesPerStep: (index) => (index === idleSteps ? burstBytes : 0),
    });

    const peak = Math.max(...observed);
    const expected = (burstBytes * 8) / 1_000_000 / (REFRESH_MS / 1000);
    expect(peak).toBeCloseTo(expected, 5); // ~79.6 Mbps, not ~8.8
  });

  it("reports zero once the counter has genuinely stopped moving", () => {
    const observed = runPolling({
      durationMs: 10_000,
      bytesPerStep: (index) => (index < 2 ? STEP_BYTES : 0),
    });

    // Ends idle: the series must fall to zero rather than hold the last rate
    // forever, which would leave a departed device drawing a flat line.
    expect(observed[observed.length - 1]).toBe(0);
    // ...but not instantly, or one late refresh blinks a live transfer to zero.
    expect(Math.max(...observed)).toBeCloseTo(STEP_MBPS, 5);
  });

  it("spreads a delta across the steps our own polling missed", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);
    // The historian stalled for five refresh intervals. The bytes are real and
    // did arrive, but over five steps, not one.
    const rates = tracker.rates(
      MAC,
      { rxBytes: 5 * STEP_BYTES, txBytes: 0 },
      T0 + 5 * REFRESH_MS,
      FALLBACK,
    );

    expect(rates.downMbps).toBeCloseTo(STEP_MBPS, 5);
  });

  it("falls back on the first reading, having nothing to subtract from", () => {
    const tracker = new ThroughputTracker();

    expect(tracker.rates(MAC, { rxBytes: 5 * MB, txBytes: 0 }, T0, FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back when the counter goes backwards, which means the device re-associated", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 900 * MB, txBytes: 50 * MB }, T0, FALLBACK);
    const rates = tracker.rates(MAC, { rxBytes: 2 * MB, txBytes: 1 * MB }, T0 + POLL_MS, FALLBACK);

    expect(rates).toEqual(FALLBACK);
  });

  it("recovers on the reading after a reset, using the new baseline", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 900 * MB, txBytes: 0 }, T0, FALLBACK);
    tracker.rates(MAC, { rxBytes: 2 * MB, txBytes: 0 }, T0 + POLL_MS, FALLBACK); // reset
    const rates = tracker.rates(
      MAC,
      { rxBytes: 2 * MB + STEP_BYTES, txBytes: 0 },
      T0 + 2 * POLL_MS,
      FALLBACK,
    );

    // Measured against the post-reset baseline, not the 900 MB that belonged to
    // the previous association.
    expect(rates.downMbps).toBeCloseTo(STEP_MBPS, 5);
  });

  it("falls back across a gap too long to call one interval", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);
    // Laptop asleep for a minute: the average over that stretch is not a moment's
    // throughput, and drawing it as one invents a plateau that never happened.
    const rates = tracker.rates(MAC, { rxBytes: 500 * MB, txBytes: 0 }, T0 + 60_000, FALLBACK);

    expect(rates).toEqual(FALLBACK);
  });

  // Defensive: measured over 90 polls under load, counters were never absent and
  // never went backwards. Pinned anyway so a firmware that does omit them cannot
  // silently turn Number(undefined) into a NaN rate.
  it("declines rather than computing from absent counters", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);

    expect(tracker.rates(MAC, undefined, T0 + POLL_MS, FALLBACK)).toEqual(FALLBACK);

    // And the blip must not become the baseline — the next real reading is still
    // measured from T0, so it reports the traffic it actually saw.
    const after = tracker.rates(
      MAC,
      { rxBytes: STEP_BYTES, txBytes: 0 },
      T0 + 2 * POLL_MS,
      FALLBACK,
    );
    expect(after.downMbps).toBeCloseTo(STEP_MBPS, 5);
  });

  it("keeps devices independent", () => {
    const tracker = new ThroughputTracker();
    const other = "11:22:33:44:55:66";
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);
    tracker.rates(other, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);

    const busy = tracker.rates(MAC, { rxBytes: STEP_BYTES, txBytes: 0 }, T0 + POLL_MS, FALLBACK);
    const quiet = tracker.rates(other, { rxBytes: 0, txBytes: 0 }, T0 + POLL_MS, FALLBACK);

    expect(busy.downMbps).toBeCloseTo(STEP_MBPS, 5);
    // Not yet idle-confirmed, so it still declines to the router's own average
    // rather than asserting zero from a single unchanged reading.
    expect(quiet).toEqual(FALLBACK);
  });

  it("forgets devices dropped from the roster", () => {
    const tracker = new ThroughputTracker();
    tracker.rates(MAC, { rxBytes: 0, txBytes: 0 }, T0, FALLBACK);
    tracker.retain([]); // device left the network

    // No baseline any more, so this reads as a first sighting rather than
    // computing a rate against a counter that belongs to a previous association.
    expect(tracker.rates(MAC, { rxBytes: STEP_BYTES, txBytes: 0 }, T0 + POLL_MS, FALLBACK)).toEqual(
      FALLBACK,
    );
  });
});
