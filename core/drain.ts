// The stateless drain: turn a dish history window plus the cursor of what a store
// already holds into the minute deltas to add and the advanced cursor to save.
//
// This is where the persisted cursor earns its keep. A long-lived collector keeps
// its open minutes in memory and recomputes them each poll; the extension cannot —
// MV3 tears its worker down between alarms, so it holds nothing between wakes. It
// persists the cursor instead and, on each wake, drains only the samples past it
// and adds them to whatever the store already recorded for those minutes. Pure and
// state-free, so a repeat wake or a re-read after teardown re-derives the same
// answer rather than double-counting.

import { selectFreshSamples, type SampleCursor, type TelemetrySample } from "./telemetry";
import { foldSamplesToMinutes, type MinuteBucket } from "./energyBuckets";

/** A decoded dish history read: the samples it held and its since-boot counter. */
export interface DishWindow {
  samples: TelemetrySample[];
  newestCounter: number;
}

export interface DrainPlan {
  /** Per-minute additions for exactly the samples past the cursor. */
  deltas: MinuteBucket[];
  /** The cursor to persist once the deltas are committed. */
  cursor: SampleCursor;
}

export function planDrain(window: DishWindow, cursor: SampleCursor): DrainPlan {
  const fresh = selectFreshSamples(window, cursor);
  const deltas = [...foldSamplesToMinutes(fresh).values()];
  // The cursor only ever moves forward. The counter tracks the dish's since-boot
  // position; a reboot restarts it below the stored value, so max() keeps the
  // stored one and selectFreshSamples falls back to the timestamp until the dish
  // counts back past it — the one place a reset could otherwise re-drain samples.
  const cursorNext: SampleCursor = {
    counter: Math.max(cursor.counter, window.newestCounter),
    newestSampleMs: fresh.reduce(
      (max, sample) => Math.max(max, sample.timestampMs),
      cursor.newestSampleMs,
    ),
  };
  return { deltas, cursor: cursorNext };
}
