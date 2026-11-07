import { describe, expect, it, vi } from "vitest";
import { StarlinkTracker } from "./satellites";

const line1 = "1 58705U 24001A   24001.50000000  .00000000  00000-0  00000-0 0  9999";
const line2 = "2 58705  53.0000  10.0000 0001000  20.0000  30.0000 15.00000000    01";

describe("StarlinkTracker hardware metadata", () => {
  it("resolves once and copies metadata to throttled fine-pass samples", async () => {
    const tracker = new StarlinkTracker([{ name: "STARLINK-TEST [DTC]", line1, line2 }], {
      latitudeDeg: 0,
      longitudeDeg: 0,
      altitudeM: 0,
    });
    // Isolate propagation: test constructor and sample transport, not orbit geometry.
    const lookAngles = vi
      .spyOn(tracker as unknown as { lookAngles: () => object }, "lookAngles")
      .mockImplementation(() => ({ name: "", azimuthDeg: 0, elevationDeg: 45, rangeKm: 600 }));
    await tracker.coarsePass();
    const samples = tracker.finePass();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      name: "STARLINK-TEST [DTC]",
      noradId: "58705",
      hardwareVersion: "V2 Mini DTC",
    });
    expect(tracker.finePass()).toBe(samples);
    lookAngles.mockRestore();
  });

  it("does not infer version from DTC name when catalog ID is unknown", async () => {
    const tracker = new StarlinkTracker(
      [
        {
          name: "STARLINK-TEST [DTC]",
          line1: line1.replace("58705", "00123"),
          line2: line2.replace("58705", "00123"),
        },
      ],
      { latitudeDeg: 0, longitudeDeg: 0, altitudeM: 0 },
    );
    const lookAngles = vi
      .spyOn(tracker as unknown as { lookAngles: () => object }, "lookAngles")
      .mockImplementation(() => ({ name: "", azimuthDeg: 0, elevationDeg: 45, rangeKm: 600 }));
    await tracker.coarsePass();
    expect(tracker.finePass()[0]).toMatchObject({ noradId: "00123", hardwareVersion: undefined });
    lookAngles.mockRestore();
  });
});
