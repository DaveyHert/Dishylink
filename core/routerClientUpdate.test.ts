import { describe, expect, test } from "vitest";
import type { DishClient } from "./dishClient";
import {
  buildRouterPauseRequest,
  buildRouterRenameRequest,
  prepareRouterClientUpdate,
} from "./routerClientUpdate";

const TARGET = "Router-010000000000000001B31340";
const config = {
  clientConfigs: [
    {
      clientId: 7,
      macAddress: "aa:bb:cc:XX:XX:XX",
      givenName: "Tablet",
      weeklyBlockSchedules: [
        { groupId: "bedtime", blockRanges: [{ startMinutes: 60, endMinutes: 120 }] },
      ],
    },
    { clientId: 8, macAddress: "dd:ee:ff:XX:XX:XX", groupId: "family" },
  ],
};

describe("buildRouterPauseRequest", () => {
  test("given: a client with another schedule, should: add permanent pause without losing data", () => {
    const request = buildRouterPauseRequest(TARGET, config, 7, true);
    const clients = request.wifiSetConfig.wifiConfig.clientConfigs;

    expect(clients[0]).toEqual({
      ...config.clientConfigs[0],
      weeklyBlockSchedules: [
        config.clientConfigs[0].weeklyBlockSchedules?.[0],
        {
          groupId: "_permanent",
          blockRanges: [{ startMinutes: 0, endMinutes: 10080 }],
        },
      ],
    });
    expect(clients[1]).toEqual(config.clientConfigs[1]);
    expect(request.wifiSetConfig.wifiConfig.applyClientConfigs).toBe(true);
  });

  test("given: a paused client, should: remove only the permanent schedule", () => {
    const paused = buildRouterPauseRequest(TARGET, config, 7, true);
    const request = buildRouterPauseRequest(
      TARGET,
      { clientConfigs: paused.wifiSetConfig.wifiConfig.clientConfigs },
      7,
      false,
    );

    expect(request.wifiSetConfig.wifiConfig.clientConfigs[0].weeklyBlockSchedules).toEqual([
      config.clientConfigs[0].weeklyBlockSchedules?.[0],
    ]);
  });

  test("given: a connected client has no saved config, should: append a minimal paused entry", () => {
    const request = buildRouterPauseRequest(TARGET, config, 99, true, {
      clientId: 99,
      macAddress: "11:22:33:XX:XX:XX",
    });

    expect(request.wifiSetConfig.wifiConfig.clientConfigs).toHaveLength(3);
    expect(request.wifiSetConfig.wifiConfig.clientConfigs[2]).toEqual({
      clientId: 99,
      macAddress: "11:22:33:XX:XX:XX",
      weeklyBlockSchedules: [
        {
          groupId: "_permanent",
          blockRanges: [{ startMinutes: 0, endMinutes: 10080 }],
        },
      ],
    });
    expect(request.wifiSetConfig.wifiConfig.clientConfigs.slice(0, 2)).toEqual(
      config.clientConfigs,
    );
  });

  test("given: an unknown client or non-router target, should: refuse the write", () => {
    expect(() => buildRouterPauseRequest(TARGET, config, 99, true)).toThrow(/live clients/);
    expect(() => buildRouterPauseRequest("ut-dish", config, 7, true)).toThrow(/router target/);
  });

  test("given: a trusted host, should: source and encode the request from router reads", async () => {
    const encoded = new Uint8Array([1, 2, 3]);
    let request: object | undefined;
    const router = {
      getWifiConfig: async () => config,
      getRouterStatus: async () => ({ deviceInfo: { id: TARGET } }),
      getWifiClients: async () => [
        { clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", givenName: "Tablet" },
      ],
      encodeRequest: (value: object) => {
        request = value;
        return encoded;
      },
    } as unknown as DishClient;

    await expect(
      prepareRouterClientUpdate(router, { kind: "pause", clientId: 7, paused: true }),
    ).resolves.toBe(encoded);
    expect(request).toMatchObject({
      targetId: TARGET,
      wifiSetConfig: {
        wifiConfig: {
          applyClientConfigs: true,
          clientConfigs: [
            expect.objectContaining({
              clientId: 7,
              weeklyBlockSchedules: [
                expect.objectContaining({ groupId: "bedtime" }),
                expect.objectContaining({ groupId: "_permanent" }),
              ],
            }),
            config.clientConfigs[1],
          ],
        },
      },
    });
  });

  test("given: the target is the host itself, should: refuse to pause but allow unpause", async () => {
    const router = {
      getWifiConfig: async () => config,
      getRouterStatus: async () => ({ deviceInfo: { id: TARGET } }),
      getWifiClients: async () => [
        { clientId: 7, macAddress: "AA:BB:CC:XX:XX:XX", ipAddress: "192.168.1.5" },
      ],
      encodeRequest: () => new Uint8Array([9]),
    } as unknown as DishClient;
    const host = { macAddresses: ["aa:bb:cc:XX:XX:XX"], ipAddresses: [] };

    await expect(
      prepareRouterClientUpdate(router, { kind: "pause", clientId: 7, paused: true }, host),
    ).rejects.toThrow(/Refusing/);
    await expect(
      prepareRouterClientUpdate(router, { kind: "pause", clientId: 7, paused: false }, host),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  test("given: the host matches only by address, should: still refuse the pause", async () => {
    const router = {
      getWifiConfig: async () => config,
      getRouterStatus: async () => ({ deviceInfo: { id: TARGET } }),
      getWifiClients: async () => [
        { clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" },
      ],
      encodeRequest: () => new Uint8Array([9]),
    } as unknown as DishClient;
    const host = { macAddresses: [], ipAddresses: ["192.168.1.5"] };

    await expect(
      prepareRouterClientUpdate(router, { kind: "pause", clientId: 7, paused: true }, host),
    ).rejects.toThrow(/Refusing/);
  });
});

describe("buildRouterRenameRequest", () => {
  test("given: a saved client, should: change only its name", () => {
    const request = buildRouterRenameRequest(TARGET, config, 7, "Studio Tablet");
    const clients = request.wifiSetConfig.wifiConfig.clientConfigs;

    expect(clients[0]).toEqual({ ...config.clientConfigs[0], givenName: "Studio Tablet" });
    expect(clients[1]).toEqual(config.clientConfigs[1]);
  });

  test("given: clients sharing a vendor-masked MAC, should: rename only the one asked for", () => {
    // This firmware masks the low three octets, so an address is not unique.
    const shared = {
      clientConfigs: [
        { clientId: 7, macAddress: "60:74:f4:XX:XX:XX", givenName: "Lamp One" },
        { clientId: 8, macAddress: "60:74:f4:XX:XX:XX", givenName: "Lamp Two" },
      ],
    };
    const clients = buildRouterRenameRequest(TARGET, shared, 8, "Lamp Renamed").wifiSetConfig
      .wifiConfig.clientConfigs;

    expect(clients[0].givenName).toBe("Lamp One");
    expect(clients[1].givenName).toBe("Lamp Renamed");
  });

  test("given: a connected device with no saved entry, should: append a named one", () => {
    const request = buildRouterRenameRequest(TARGET, config, 99, "New Thing", {
      clientId: 99,
      macAddress: "11:22:33:XX:XX:XX",
    });

    expect(request.wifiSetConfig.wifiConfig.clientConfigs).toHaveLength(3);
    expect(request.wifiSetConfig.wifiConfig.clientConfigs[2]).toEqual({
      clientId: 99,
      macAddress: "11:22:33:XX:XX:XX",
      givenName: "New Thing",
    });
  });

  test("given: a client the router has never reported, should: refuse rather than append", () => {
    expect(() => buildRouterRenameRequest(TARGET, config, 99, "Ghost")).toThrow(
      /not known to the router/,
    );
  });

  test("given: a non-router target, should: refuse the write", () => {
    expect(() => buildRouterRenameRequest("ut-dish", config, 7, "x")).toThrow(/router target/);
  });

  test("given: an offline device, should: prepare without needing the live roster", async () => {
    let request: object | undefined;
    const router = {
      getWifiConfig: async () => config,
      getRouterStatus: async () => ({ deviceInfo: { id: TARGET } }),
      getWifiClients: async () => {
        throw new Error("the roster must not be needed to rename a saved device");
      },
      encodeRequest: (value: object) => {
        request = value;
        return new Uint8Array([4]);
      },
    } as unknown as DishClient;

    await expect(
      prepareRouterClientUpdate(router, {
        kind: "rename",
        clientId: 7,
        givenName: "Studio Tablet",
      }),
    ).resolves.toEqual(new Uint8Array([4]));
    expect(request).toMatchObject({
      targetId: TARGET,
      wifiSetConfig: { wifiConfig: { applyClientConfigs: true } },
    });
  });
});
