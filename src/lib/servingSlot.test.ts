// The claim is a sequence, not a single call: one satellite for a whole slot.

import { describe, expect, it } from "vitest";
import { chooseServingCandidate, slotIndexAt, type ServingHold } from "./servingSlot";
import type { SatelliteSky } from "./satellites";

const sat = (name: string, elevationDeg: number): SatelliteSky => ({
  name,
  azimuthDeg: 0,
  elevationDeg,
  rangeKm: 550,
});

/** Sorted by elevation, as the tracker's fine pass returns them. */
const inViewOf = (...sats: SatelliteSky[]) =>
  [...sats].sort((a, b) => b.elevationDeg - a.elevationDeg);

const clear = () => true;

function ride(
  startMs: number,
  seconds: number,
  skyAt: (second: number) => SatelliteSky[],
  isUnobstructed: (sky: SatelliteSky, second: number) => boolean = clear,
) {
  let hold: ServingHold | null = null;
  const names: (string | null)[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const choice = chooseServingCandidate(skyAt(second), startMs + second * 1_000, hold, (sky) =>
      isUnobstructed(sky, second),
    );
    hold = choice.hold;
    names.push(choice.candidate?.name ?? null);
  }
  return names;
}

describe("slot boundaries", () => {
  it("falls on the shared :00/:15/:30/:45 clock", () => {
    const at = (s: number, ms = 0) => Date.UTC(2026, 0, 1, 12, 0, s, ms);
    expect(slotIndexAt(at(14, 999))).toBe(slotIndexAt(at(0)));
    expect(slotIndexAt(at(15))).toBe(slotIndexAt(at(0)) + 1);
    expect(slotIndexAt(at(45))).toBe(slotIndexAt(at(30)) + 1);
  });
});

describe("chooseServingCandidate", () => {
  const boundary = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("holds one satellite per slot while a rival climbs past it", () => {
    // B overtakes A five seconds in; re-picking every sample would follow it.
    const skyAt = (second: number) => inViewOf(sat("A", 70), sat("B", 60 + second * 3));
    const names = ride(boundary, 30, skyAt);

    expect(names.slice(0, 15)).toEqual(Array(15).fill("A"));
    expect(names.slice(15)).toEqual(Array(15).fill("B"));
    expect(new Set(names).size).toBe(2);
  });

  it("drops a held satellite that goes behind an obstruction", () => {
    const skyAt = () => inViewOf(sat("A", 70), sat("B", 60));
    const names = ride(boundary, 20, skyAt, (sky, second) => !(sky.name === "A" && second >= 3));

    expect(names.slice(0, 3)).toEqual(["A", "A", "A"]);
    expect(names.slice(3)).toEqual(Array(17).fill("B"));
  });

  it("keeps the slot in progress when a replacement is forced mid-slot", () => {
    // B takes over 3s in, so it serves the remaining 12s and no longer.
    const skyAt = () => inViewOf(sat("A", 70), sat("B", 60), sat("C", 50));
    const names = ride(boundary, 20, skyAt, (sky, second) => {
      if (sky.name === "A") return second < 3;
      if (sky.name === "B") return second < 15 || second >= 18;
      return true;
    });

    expect(names.slice(3, 15)).toEqual(Array(12).fill("B"));
    expect(names[15]).toBe("C");
  });

  it("ignores a hold left over from an earlier slot", () => {
    const inView = inViewOf(sat("A", 70), sat("B", 60));
    const stale: ServingHold = { slotIndex: slotIndexAt(boundary) - 1, name: "B" };
    expect(chooseServingCandidate(inView, boundary, stale, clear).candidate?.name).toBe("A");
  });

  it("falls back to the highest satellite when every one is obstructed", () => {
    const inView = inViewOf(sat("A", 70), sat("B", 60));
    const choice = chooseServingCandidate(inView, boundary, null, () => false);
    expect(choice.candidate?.name).toBe("A");
  });

  it("serves nothing when the sky is empty or below the service floor", () => {
    expect(chooseServingCandidate([], boundary, null, clear)).toEqual({
      candidate: null,
      hold: null,
    });
    expect(chooseServingCandidate([sat("A", 10)], boundary, null, clear).candidate).toBeNull();
  });
});
