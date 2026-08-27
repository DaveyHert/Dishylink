// The join the self-pause guard depends on: what the window recorded has to
// reach `prepareRouterClientUpdate` as part of this host's identity.

import { describe, expect, test, vi } from "vitest";
import { prepareRouterClientUpdate } from "../core/routerClientUpdate";

const stored: { selfClientId: number | null } = { selfClientId: null };

vi.mock("./preferences", () => ({
  preferences: () => stored,
  setPreference: (key: "selfClientId", value: number | null) => {
    stored[key] = value;
  },
}));

const { hostIdentity, rememberSelfDevice } = await import("./selfDevice");

const TARGET = "Router-010000000000000001B31340";
const roster = [{ clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" }];

/** A router reachable only through a gateway, as the real one is off the LAN. */
function gatewayRouter() {
  const encoded = new Uint8Array([9]);
  return {
    encoded,
    codec: {
      encodeRequest: (value: object) =>
        "wifiGetConfig" in value
          ? new Uint8Array([1])
          : "wifiGetClients" in value
            ? new Uint8Array([2])
            : encoded,
      decodeResponse: (bytes: Uint8Array) =>
        bytes[0] === 1
          ? { wifiGetConfig: { wifiConfig: { clientConfigs: [{ clientId: 7 }] } } }
          : { wifiGetClients: { clients: roster } },
    },
    callGateway: async (bytes: Uint8Array) => bytes,
  };
}

describe("hostIdentity", () => {
  test("given: nothing recorded yet, should: carry addresses alone", () => {
    stored.selfClientId = null;

    expect(hostIdentity().clientId).toBeUndefined();
  });

  test("given: an id the window recorded, should: refuse that device from off the network", async () => {
    rememberSelfDevice(7);
    const router = gatewayRouter();

    expect(hostIdentity().clientId).toBe(7);
    await expect(
      prepareRouterClientUpdate(
        router.codec,
        { kind: "pause", clientId: 7, paused: true },
        TARGET,
        router.callGateway,
        hostIdentity(),
      ),
    ).rejects.toThrow(/Refusing/);
  });

  test("given: an id outside a uint32, should: keep what is stored", () => {
    rememberSelfDevice(7);
    rememberSelfDevice(-1);

    expect(hostIdentity().clientId).toBe(7);
  });
});
