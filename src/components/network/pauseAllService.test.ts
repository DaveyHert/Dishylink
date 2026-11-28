// What the bulk-pause service guarantees: which devices it will touch, that a
// failure part-way through does not abandon the rest, and that every device's
// outcome is reported so the UI can name the ones that did not take.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WifiClientJson } from "@core/dishClient";
import { applyPauseAll, pauseableDevices, pauseTargets } from "./pauseAllService";

const setPaused = vi.fn<(clientId: number, paused: boolean) => Promise<void>>();

vi.mock("../../lib/routerClientUpdate", () => ({
  setRouterClientPaused: (clientId: number, paused: boolean) => setPaused(clientId, paused),
}));

const device = (clientId: number, blocked = false, name?: string): WifiClientJson => ({
  clientId,
  macAddress: `aa:bb:cc:00:00:0${clientId}`,
  givenName: name,
  blocked,
  role: "CLIENT",
});

beforeEach(() => {
  setPaused.mockReset();
  setPaused.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("pauseableDevices", () => {
  it("leaves out the viewer's own device and anything with no router id", () => {
    const devices: WifiClientJson[] = [
      device(1),
      device(2),
      { macAddress: "aa:bb:cc:00:00:99", role: "CLIENT" },
    ];
    expect(pauseableDevices(devices, 1).map((entry) => entry.clientId)).toEqual([2]);
  });

  it("includes every device when the viewer is unresolved", () => {
    expect(pauseableDevices([device(1), device(2)], undefined)).toHaveLength(2);
  });
});

describe("pauseTargets", () => {
  it("given: pausing, should: skip devices already paused", () => {
    const targets = pauseTargets([device(1), device(2, true), device(3)], undefined, true);
    expect(targets.map((target) => target.clientId)).toEqual([1, 3]);
  });

  it("given: unpausing, should: touch only devices that are paused", () => {
    const targets = pauseTargets([device(1), device(2, true), device(3, true)], undefined, false);
    expect(targets.map((target) => target.clientId)).toEqual([2, 3]);
  });

  it("given: no name on the roster, should: still name the target readably", () => {
    const [target] = pauseTargets([device(4, false, undefined)], undefined, true);
    expect(target.name).toBe("aa:bb:cc:00:00:04");
  });
});

describe("applyPauseAll", () => {
  it("given: every write succeeds, should: report each device as successful", async () => {
    const progress: number[] = [];
    const results = await applyPauseAll(
      [
        { clientId: 1, name: "Laptop" },
        { clientId: 2, name: "Tablet" },
      ],
      true,
      (update) => progress.push(update.done),
    );

    expect(results.map((result) => result.outcome)).toEqual(["success", "success"]);
    expect(setPaused.mock.calls).toEqual([
      [1, true],
      [2, true],
    ]);
    // Reported after each write, so the counter advances as it goes.
    expect(progress).toEqual([1, 2]);
  });

  it("given: a write fails part-way, should: carry on and record the failure", async () => {
    setPaused
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockResolvedValueOnce(undefined);

    const results = await applyPauseAll(
      [
        { clientId: 1, name: "Laptop" },
        { clientId: 2, name: "Tablet" },
        { clientId: 3, name: "Console" },
      ],
      false,
      () => {},
    );

    expect(results.map((result) => result.outcome)).toEqual(["success", "failed", "success"]);
    expect(results[1].error).toBe("gateway timeout");
    // The third device was still attempted — one failure does not abandon the run.
    expect(setPaused).toHaveBeenCalledTimes(3);
  });

  it("given: every write fails, should: still resolve rather than throw", async () => {
    setPaused.mockRejectedValue(new Error("offline"));

    const results = await applyPauseAll([{ clientId: 7, name: "Phone" }], true, () => {});

    expect(results).toEqual([{ clientId: 7, name: "Phone", outcome: "failed", error: "offline" }]);
  });

  it("given: nothing to do, should: report nothing and write nothing", async () => {
    const results = await applyPauseAll([], true, () => {});
    expect(results).toEqual([]);
    expect(setPaused).not.toHaveBeenCalled();
  });
});
