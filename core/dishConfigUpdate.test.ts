import { describe, expect, test } from "vitest";
import type { DishClient } from "./dishClient";
import { prepareDishConfigUpdate } from "./dishConfigUpdate";

const TARGET = "ut01000000-00000000-000000ab";

describe("prepareDishConfigUpdate", () => {
  test("given: a trusted host, should: source the target from the dish and encode only the changed fields", async () => {
    const encoded = new Uint8Array([1, 2, 3]);
    let request: object | undefined;
    const dish = {
      getDeviceInfo: async () => ({ id: TARGET }),
      encodeRequest: (value: object) => {
        request = value;
        return encoded;
      },
    } as unknown as DishClient;

    await expect(prepareDishConfigUpdate(dish, { swupdateRebootHour: 15 })).resolves.toBe(encoded);
    expect(request).toEqual({
      targetId: TARGET,
      dishSetConfig: {
        dishConfig: { swupdateRebootHour: 15, applySwupdateRebootHour: true },
      },
    });
  });

  test("given: several fields at once, should: set the apply flag for each and skip untouched ones", async () => {
    let request: object | undefined;
    const dish = {
      getDeviceInfo: async () => ({ id: TARGET }),
      encodeRequest: (value: object) => {
        request = value;
        return new Uint8Array([4]);
      },
    } as unknown as DishClient;

    await prepareDishConfigUpdate(dish, {
      powerSaveMode: true,
      powerSaveStartMinutes: 60,
      powerSaveDurationMinutes: undefined,
    });

    expect(request).toEqual({
      targetId: TARGET,
      dishSetConfig: {
        dishConfig: {
          powerSaveMode: true,
          applyPowerSaveMode: true,
          powerSaveStartMinutes: 60,
          applyPowerSaveStartMinutes: true,
        },
      },
    });
  });

  test("given: no dish identity, should: refuse before encoding", async () => {
    const dish = {
      getDeviceInfo: async () => ({}),
      encodeRequest: () => {
        throw new Error("must not encode without a target id");
      },
    } as unknown as DishClient;

    await expect(prepareDishConfigUpdate(dish, { powerSaveMode: false })).rejects.toThrow(
      /identity is unavailable/,
    );
  });

  test("given: a non-dish target id, should: refuse the write", async () => {
    const dish = {
      getDeviceInfo: async () => ({ id: "Router-010000000000000001B31340" }),
      encodeRequest: () => new Uint8Array([9]),
    } as unknown as DishClient;

    await expect(prepareDishConfigUpdate(dish, { powerSaveMode: false })).rejects.toThrow(
      /dish target id/,
    );
  });
});
