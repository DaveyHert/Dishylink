import { describe, expect, it } from "vitest";
import { singleFlight } from "./singleFlight";

/** A run that finishes only when the test says so. */
function pending() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

describe("singleFlight", () => {
  it("joins a caller arriving while a run is in flight", async () => {
    const first = pending();
    let runs = 0;
    const guarded = singleFlight(() => {
      runs += 1;
      return first.done;
    });

    const a = guarded();
    const b = guarded();
    expect(runs).toBe(1);

    first.release();
    await Promise.all([a, b]);
    expect(runs).toBe(1);
  });

  it("runs again once the previous one has settled", async () => {
    let runs = 0;
    const guarded = singleFlight(async () => {
      runs += 1;
    });

    await guarded();
    await guarded();

    expect(runs).toBe(2);
  });

  it("frees the slot after a run that threw", async () => {
    let runs = 0;
    const guarded = singleFlight(async () => {
      runs += 1;
      throw new Error("drain failed");
    });

    await expect(guarded()).rejects.toThrow("drain failed");
    await expect(guarded()).rejects.toThrow("drain failed");
    expect(runs).toBe(2);
  });
});
