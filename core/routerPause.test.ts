import { describe, expect, test } from "vitest";
import type { DishClient } from "./dishClient";
import { buildRouterPauseRequest, prepareRouterPauseRequest } from "./routerPause";

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

    await expect(prepareRouterPauseRequest(router, 7, true)).resolves.toBe(encoded);
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

    await expect(prepareRouterPauseRequest(router, 7, true, host)).rejects.toThrow(/Refusing/);
    await expect(prepareRouterPauseRequest(router, 7, false, host)).resolves.toBeInstanceOf(
      Uint8Array,
    );
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

    await expect(prepareRouterPauseRequest(router, 7, true, host)).rejects.toThrow(/Refusing/);
  });
});
