import { describe, expect, it } from "vitest";
import type { WifiClientJson, WifiNetworkConfigJson } from "@core/dishClient";
import { buildNodeRoster } from "./nodeRoster";

const CONTROLLER = "Router-010000000000000001B31340";
const NODE = "Router-01000000000000000049375B";

const controllerClient: WifiClientJson = {
  deviceId: CONTROLLER,
  macAddress: "74:24:9f:43:13:40",
  role: "CONTROLLER",
  name: "Controller",
};
const repeaterClient: WifiClientJson = {
  deviceId: NODE,
  macAddress: "74:24:9f:d9:37:5b",
  role: "REPEATER",
  name: "hostname-1",
};

describe("buildNodeRoster", () => {
  it("names a live node from its meshConfigs displayName over the hostname", () => {
    const wifiConfig = {
      meshConfigs: { [NODE]: { displayName: "Garage" } },
    } as unknown as WifiNetworkConfigJson;
    const roster = buildNodeRoster([controllerClient, repeaterClient], wifiConfig);
    expect(roster.find((node) => node.key === NODE)?.name).toBe("Garage");
  });

  it("prefers the configured name even when the client carries a givenName", () => {
    const named: WifiClientJson = { ...repeaterClient, givenName: "Old name" };
    const wifiConfig = {
      meshConfigs: { [NODE]: { displayName: "Garage" } },
    } as unknown as WifiNetworkConfigJson;
    expect(buildNodeRoster([named], wifiConfig).find((n) => n.key === NODE)?.name).toBe("Garage");
  });

  it("falls back to the hostname when no name is configured", () => {
    expect(buildNodeRoster([repeaterClient], null).find((n) => n.key === NODE)?.name).toBe(
      "hostname-1",
    );
  });

  it("lists a paired-but-down node from meshConfigs alone", () => {
    const wifiConfig = {
      meshConfigs: { [NODE]: { displayName: "Garage" } },
    } as unknown as WifiNetworkConfigJson;
    const roster = buildNodeRoster([controllerClient], wifiConfig);
    const down = roster.find((node) => node.key === NODE);
    expect(down).toMatchObject({ name: "Garage", connected: false, status: "Disconnected" });
  });
});
