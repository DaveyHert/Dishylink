import { describe, expect, test } from "vitest";
import type { WifiClientJson } from "./dishClient";
import {
  buildRouterPauseRequest,
  buildRouterRenameRequest,
  prepareRouterClientUpdate,
  readRouterClients,
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

/**
 * A router reachable only the way the real one is: through a gateway.
 *
 * `encodeRequest` tags each read with a byte, the gateway echoes it, and
 * `decodeResponse` answers with the config or the roster accordingly — so a
 * preparation that skips a read cannot accidentally be served one. The write it
 * finally encodes is captured rather than sent.
 */
function gatewayRouter({
  clients = [],
}: {
  /** A function throws where the roster must never be asked for. */
  clients?: WifiClientJson[] | (() => never);
} = {}) {
  const encoded = new Uint8Array([1, 2, 3]);
  const captured: { request?: object } = {};
  const codec = {
    encodeRequest: (value: object) => {
      const json = value as Record<string, unknown>;
      if ("wifiGetConfig" in json) return new Uint8Array([1]);
      if ("wifiGetClients" in json) return new Uint8Array([2]);
      captured.request = json;
      return encoded;
    },
    decodeResponse: (responseBytes: Uint8Array) =>
      responseBytes[0] === 1
        ? { wifiGetConfig: { wifiConfig: config } }
        : {
            wifiGetClients: {
              clients: typeof clients === "function" ? clients() : clients,
            },
          },
  };
  return {
    codec,
    callGateway: async (requestBytes: Uint8Array) => requestBytes,
    captured,
    encoded,
  };
}

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

  test("given: a trusted host, should: source and encode the request from gateway reads", async () => {
    const router = gatewayRouter({
      clients: [{ clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", givenName: "Tablet" }],
    });

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
      ),
    ).resolves.toBe(router.encoded);
    expect(router.captured.request).toMatchObject({
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
    const router = gatewayRouter({
      clients: [{ clientId: 7, macAddress: "AA:BB:CC:XX:XX:XX", ipAddress: "192.168.1.5" }],
    });
    const host = { macAddresses: ["aa:bb:cc:XX:XX:XX"], ipAddresses: [] };

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
        host,
      ),
    ).rejects.toThrow(/Refusing/);
    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: false },
        TARGET,
        router.callGateway,
        host,
      ),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  test("given: the host matches only by address, should: still refuse the pause", async () => {
    const router = gatewayRouter({
      clients: [{ clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" }],
    });
    const host = { macAddresses: [], ipAddresses: ["192.168.1.5"] };

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
        host,
      ),
    ).rejects.toThrow(/Refusing/);
  });

  test("given: a viewer off the router's network, should: leave the address guard silent", async () => {
    // Nothing on the roster can match a host that is somewhere else entirely, so
    // an identity carrying only addresses has nothing to say there.
    const router = gatewayRouter({
      clients: [{ clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" }],
    });
    const elsewhere = { macAddresses: ["de:ad:be:ef:00:01"], ipAddresses: ["10.20.30.40"] };

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
        elsewhere,
      ),
    ).resolves.toBe(router.encoded);
  });

  test("given: a remembered clientId, should: refuse a self-pause from off the network", async () => {
    const router = gatewayRouter({
      clients: [
        { clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" },
        { clientId: 8, macAddress: "dd:ee:ff:XX:XX:XX", ipAddress: "192.168.1.6" },
      ],
    });
    const elsewhere = {
      macAddresses: ["de:ad:be:ef:00:01"],
      ipAddresses: ["10.20.30.40"],
      clientId: 7,
    };

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
        elsewhere,
      ),
    ).rejects.toThrow(/Refusing/);
    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 8, paused: true },
        TARGET,
        router.callGateway,
        elsewhere,
      ),
    ).resolves.toBe(router.encoded);
  });

  test("given: a remembered id the router has since renumbered, should: still refuse by address", async () => {
    const router = gatewayRouter({
      clients: [{ clientId: 9, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" }],
    });
    const host = { macAddresses: ["aa:bb:cc:XX:XX:XX"], ipAddresses: ["192.168.1.5"], clientId: 7 };

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 9, paused: true },
        TARGET,
        router.callGateway,
        host,
      ),
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
    const router = gatewayRouter({
      clients: () => {
        throw new Error("the roster must not be needed to rename a saved device");
      },
    });

    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "rename", clientId: 7, givenName: "Studio Tablet" },
        TARGET,
        router.callGateway,
      ),
    ).resolves.toBe(router.encoded);
    expect(router.captured.request).toMatchObject({
      targetId: TARGET,
      wifiSetConfig: { wifiConfig: { applyClientConfigs: true } },
    });
  });
});

describe("readRouterClients", () => {
  test("given: a gateway reply, should: name the target and serve the roster it carries", async () => {
    let request: object | undefined;
    const codec = {
      encodeRequest: (value: object) => {
        request = value;
        return new Uint8Array([9]);
      },
      decodeResponse: () => ({
        wifiGetClients: { clients: [{ clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX" }] },
      }),
    };

    await expect(readRouterClients(codec, TARGET, async () => new Uint8Array())).resolves.toEqual([
      { clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX" },
    ]);
    expect(request).toEqual({ targetId: TARGET, wifiGetClients: {} });
  });

  test("given: a router reporting nobody, should: answer with an empty roster", async () => {
    const codec = {
      encodeRequest: () => new Uint8Array([9]),
      decodeResponse: () => ({}),
    };

    await expect(readRouterClients(codec, TARGET, async () => new Uint8Array())).resolves.toEqual(
      [],
    );
  });
});
