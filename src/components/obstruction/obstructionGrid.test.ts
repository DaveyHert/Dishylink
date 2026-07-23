import { describe, expect, it } from "vitest";
import { liveKindAtCell, snapshotKindAtCell } from "./obstructionGrid";
import {
  CELL_CLEAR,
  CELL_OBSTRUCTED,
  CELL_PARTIAL,
  CELL_UNMAPPED,
} from "../../lib/obstructionSnapshots";

describe("liveKindAtCell", () => {
  //          clear  obstructed  partial  never observed
  const grid = [1, 0, 0.85, -1];
  const kindAt = liveKindAtCell(grid, 2);

  it("reads a negative usable fraction as never observed", () => {
    expect(kindAt(1, 1)).toBe("unmapped");
  });

  it("calls a fully usable cell clear and a fully blocked one obstructed", () => {
    expect(kindAt(0, 0)).toBe("clear");
    expect(kindAt(0, 1)).toBe("obstructed");
  });

  it("puts a partly blocked cell in between", () => {
    expect(kindAt(1, 0)).toBe("partial");
  });
});

describe("snapshotKindAtCell", () => {
  it("maps each stored bucket back to its kind", () => {
    const cells = Uint8Array.from([CELL_UNMAPPED, CELL_CLEAR, CELL_PARTIAL, CELL_OBSTRUCTED]);
    const kindAt = snapshotKindAtCell(cells, 2);
    expect(kindAt(0, 0)).toBe("unmapped");
    expect(kindAt(0, 1)).toBe("clear");
    expect(kindAt(1, 0)).toBe("partial");
    expect(kindAt(1, 1)).toBe("obstructed");
  });
});
