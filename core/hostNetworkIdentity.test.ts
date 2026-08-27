import { describe, it, expect } from "vitest";
import { identityFromEnv, resolveHostIdentity } from "./hostNetworkIdentity";

describe("identityFromEnv", () => {
  it("returns null when neither variable is set", () => {
    expect(identityFromEnv({})).toBeNull();
    expect(identityFromEnv({ HOST_LAN_IP: "", HOST_MAC: "  " })).toBeNull();
  });

  it("splits, trims, and lowercases a comma-separated list", () => {
    expect(
      identityFromEnv({
        HOST_LAN_IP: "192.168.1.45, ::ffff:10.0.0.2",
        HOST_MAC: "AA:BB:CC:DD:EE:FF, 11:22:33:44:55:66",
      }),
    ).toEqual({
      ipAddresses: ["192.168.1.45", "10.0.0.2"],
      macAddresses: ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"],
    });
  });

  it("accepts IPs or MACs alone", () => {
    expect(identityFromEnv({ HOST_LAN_IP: "192.168.1.45" })).toEqual({
      ipAddresses: ["192.168.1.45"],
      macAddresses: [],
    });
    expect(identityFromEnv({ HOST_MAC: "aa:bb:cc:dd:ee:ff" })).toEqual({
      ipAddresses: [],
      macAddresses: ["aa:bb:cc:dd:ee:ff"],
    });
  });
});

describe("resolveHostIdentity", () => {
  it("prefers the env identity when one is set", () => {
    expect(resolveHostIdentity({ HOST_LAN_IP: "192.168.1.45" }).ipAddresses).toEqual([
      "192.168.1.45",
    ]);
  });
});
