import { describe, expect, it } from "vitest";
import {
  buildRouterConfigRequest,
  buildSubnetNetworks,
  normalizeNameservers,
  readCurrentNetworks,
  readCurrentSubnet,
  routerAddressForSubnet,
  subnetRefusal,
  MAX_NAMESERVERS,
  SUBNET_PRESETS,
} from "./routerConfigUpdate";

const TARGET = "Router-010000000000000001B31340";

/** Shaped like the router's own reply: router-assigned identifiers present, and
 *  the passphrase masked the way the firmware reports it. */
const ROUTER_NETWORKS = [
  {
    ipv4: "192.168.1.1/24",
    isGuest: false,
    basicServiceSets: [
      {
        ssid: "StarL X",
        band: "RF_2GHZ",
        bssid: "aa:bb:cc:dd:ee:ff",
        ifaceName: "wlan0",
        authWpa2: { password: "•••••" },
      },
      {
        ssid: "StarL X",
        band: "RF_5GHZ",
        bssid: "aa:bb:cc:dd:ee:00",
        ifaceName: "wlan1",
        authWpa2: { password: "•••••" },
      },
    ],
  },
  { isGuest: true, basicServiceSets: [] },
];

describe("normalizeNameservers", () => {
  it("keeps order, so the first stays the primary", () => {
    expect(normalizeNameservers(["1.1.1.1", "1.0.0.1"])).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("accepts IPv6 resolvers alongside IPv4", () => {
    expect(normalizeNameservers(["1.1.1.1", "2606:4700:4700::1111"])).toEqual([
      "1.1.1.1",
      "2606:4700:4700::1111",
    ]);
  });

  it("drops a repeated resolver rather than sending it twice", () => {
    expect(normalizeNameservers(["1.1.1.1", "1.1.1.1"])).toEqual(["1.1.1.1"]);
  });

  it("treats an empty list as valid — that is how custom DNS is turned off", () => {
    expect(normalizeNameservers([])).toEqual([]);
  });

  it("refuses anything that is not a literal address", () => {
    expect(normalizeNameservers(["dns.google"])).toBeNull();
    expect(normalizeNameservers(["1.1.1"])).toBeNull();
    expect(normalizeNameservers(["1.1.1.256"])).toBeNull();
    expect(normalizeNameservers(["1.1.1.1", "nonsense"])).toBeNull();
  });

  it("refuses more than the router's own app offers", () => {
    const tooMany = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9"];
    expect(tooMany.length).toBeGreaterThan(MAX_NAMESERVERS);
    expect(normalizeNameservers(tooMany)).toBeNull();
  });
});

describe("buildRouterConfigRequest", () => {
  it("names only the DNS fields, so no other setting rides along", () => {
    const request = buildRouterConfigRequest(TARGET, {
      kind: "customDns",
      nameservers: ["1.1.1.1", "1.0.0.1"],
    });
    expect(request).toEqual({
      targetId: TARGET,
      wifiSetConfig: {
        wifiConfig: { nameservers: ["1.1.1.1", "1.0.0.1"], applyNameservers: true },
      },
    });
    // The passphrase lives under `networks`, which this must never carry: it only
    // ever reads back masked, so resending it would write the mask.
    expect(Object.keys(request.wifiSetConfig!.wifiConfig)).toEqual([
      "nameservers",
      "applyNameservers",
    ]);
  });

  it("still sets the apply flag when clearing, so the router acts on the empty list", () => {
    const request = buildRouterConfigRequest(TARGET, { kind: "customDns", nameservers: [] });
    expect(request.wifiSetConfig!.wifiConfig).toEqual({ nameservers: [], applyNameservers: true });
  });

  it("names only the bypass fields, so no other setting rides along", () => {
    const request = buildRouterConfigRequest(TARGET, { kind: "bypass", enabled: true });
    expect(request).toEqual({
      targetId: TARGET,
      wifiSetConfig: { wifiConfig: { bypassMode: true, applyBypassMode: true } },
    });
    expect(Object.keys(request.wifiSetConfig!.wifiConfig)).toEqual([
      "bypassMode",
      "applyBypassMode",
    ]);
  });

  it("sends the apply flag when switching bypass off, not just when turning it on", () => {
    const request = buildRouterConfigRequest(TARGET, { kind: "bypass", enabled: false });
    expect(request.wifiSetConfig!.wifiConfig).toEqual({
      bypassMode: false,
      applyBypassMode: true,
    });
  });

  it("sends a factory reset as its own oneof arm, carrying no config with it", () => {
    // The router's only exit from bypass, and it must not smuggle a wifi write.
    expect(buildRouterConfigRequest(TARGET, { kind: "factoryReset" })).toEqual({
      targetId: TARGET,
      factoryReset: {},
    });
  });

  it("refuses a target that is not a router", () => {
    expect(() =>
      buildRouterConfigRequest("ut0158168c-42207c02-5946ca71", {
        kind: "customDns",
        nameservers: ["1.1.1.1"],
      }),
    ).toThrow(/invalid router target id/);
  });

  it("refuses a bad resolver rather than sending it", () => {
    expect(() =>
      buildRouterConfigRequest(TARGET, { kind: "customDns", nameservers: ["dns.google"] }),
    ).toThrow(/invalid DNS server address/);
  });
});

describe("buildSubnetNetworks", () => {
  const built = buildSubnetNetworks(ROUTER_NETWORKS, "192.168.2.1/24", "hunter2hunter2");

  it("drops the router-assigned identifiers, which make the firmware discard the message", () => {
    for (const network of built) {
      for (const set of network.basicServiceSets as Record<string, unknown>[]) {
        expect(set).not.toHaveProperty("bssid");
        expect(set).not.toHaveProperty("ifaceName");
      }
    }
  });

  it("leaves an external auth server's credential alone", () => {
    const withRadius = [
      {
        ipv4: "192.168.1.1/24",
        basicServiceSets: [
          {
            ssid: "StarL X",
            authWpa2: { password: "\u2022\u2022\u2022\u2022\u2022" },
            authRadius: { server: "10.0.0.9", password: "radius-shared-secret" },
          },
        ],
      },
    ];
    const sets = buildSubnetNetworks(withRadius, "192.168.2.1/24", "hunter2hunter2")[0]
      .basicServiceSets as { authWpa2: { password: string }; authRadius: { password: string } }[];
    expect(sets[0].authWpa2.password).toBe("hunter2hunter2");
    expect(sets[0].authRadius.password).toBe("radius-shared-secret");
  });

  it("replaces the masked passphrase everywhere it appears", () => {
    const sets = built[0].basicServiceSets as { authWpa2: { password: string } }[];
    expect(sets.map((set) => set.authWpa2.password)).toEqual(["hunter2hunter2", "hunter2hunter2"]);
  });

  it("moves only the first network, which is the one carrying the LAN address", () => {
    expect(built[0].ipv4).toBe("192.168.2.1/24");
    expect(built[1]).not.toHaveProperty("ipv4");
  });

  it("keeps every field it was not asked to change", () => {
    expect(built[0].isGuest).toBe(false);
    const sets = built[0].basicServiceSets as { ssid: string; band: string }[];
    expect(sets[0]).toMatchObject({ ssid: "StarL X", band: "RF_2GHZ" });
  });

  it("leaves the router's own reply untouched", () => {
    expect(ROUTER_NETWORKS[0].basicServiceSets[0]).toHaveProperty("bssid");
    expect(ROUTER_NETWORKS[0].ipv4).toBe("192.168.1.1/24");
  });
});

describe("subnetRefusal", () => {
  it("accepts every preset the official app offers", () => {
    for (const preset of SUBNET_PRESETS) expect(subnetRefusal(preset, "hunter2hunter2")).toBeNull();
  });

  it("refuses a subnet outside the presets", () => {
    expect(subnetRefusal("172.16.0.1/24", "hunter2hunter2")).toMatch(/unsupported/);
  });

  it("refuses a passphrase no device could reconnect with", () => {
    expect(subnetRefusal("192.168.2.1/24", "short")).toMatch(/8 to 63 characters/);
  });

  it("refuses an empty passphrase, which is what the masked value would become", () => {
    expect(subnetRefusal("192.168.2.1/24", "")).toMatch(/8 to 63 characters/);
  });

  it("refuses a passphrase past WPA2's ceiling", () => {
    expect(subnetRefusal("192.168.2.1/24", "x".repeat(64))).toMatch(/8 to 63 characters/);
    expect(subnetRefusal("192.168.2.1/24", "x".repeat(63))).toBeNull();
  });
});

describe("buildRouterConfigRequest for a subnet", () => {
  it("sends the networks block with the apply flag and nothing else", () => {
    const request = buildRouterConfigRequest(
      TARGET,
      { kind: "subnet", subnet: "192.168.2.1/24", password: "hunter2hunter2" },
      ROUTER_NETWORKS,
    );
    expect(Object.keys(request.wifiSetConfig!.wifiConfig)).toEqual(["networks", "applyNetworks"]);
    expect(request.wifiSetConfig!.wifiConfig.applyNetworks).toBe(true);
  });

  it("refuses when the router reported no networks, rather than wiping them", () => {
    expect(() =>
      buildRouterConfigRequest(
        TARGET,
        { kind: "subnet", subnet: "192.168.2.1/24", password: "hunter2hunter2" },
        [],
      ),
    ).toThrow(/no networks/);
  });

  it("refuses a bad passphrase before the account is touched", () => {
    expect(() =>
      buildRouterConfigRequest(
        TARGET,
        { kind: "subnet", subnet: "192.168.2.1/24", password: "short" },
        ROUTER_NETWORKS,
      ),
    ).toThrow(/8 to 63 characters/);
  });
});

describe("readCurrentSubnet", () => {
  const codecReturning = (networks: unknown[] | undefined) => ({
    encodeRequest: () => new Uint8Array([1]),
    decodeResponse: () => ({ wifiGetConfig: { wifiConfig: { networks } } }),
  });
  const callGateway = async () => new Uint8Array();

  it("reads the range off the first network the router names", async () => {
    expect(await readCurrentSubnet(codecReturning(ROUTER_NETWORKS), TARGET, callGateway)).toBe(
      "192.168.1.1/24",
    );
  });

  it("has no answer for a router that names no networks", async () => {
    // What a bypassed kit reports.
    expect(await readCurrentSubnet(codecReturning([]), TARGET, callGateway)).toBeNull();
    expect(await readCurrentSubnet(codecReturning(undefined), TARGET, callGateway)).toBeNull();
  });

  it("has no answer when the network carries no range", async () => {
    expect(
      await readCurrentSubnet(codecReturning([{ isGuest: false }]), TARGET, callGateway),
    ).toBeNull();
  });
});

describe("readCurrentNetworks", () => {
  const codec = {
    encodeRequest: () => new Uint8Array([1]),
    decodeResponse: () => ({ wifiGetConfig: { wifiConfig: { networks: ROUTER_NETWORKS } } }),
  };

  it("reads the router for a subnet change", async () => {
    let sent = 0;
    const networks = await readCurrentNetworks(
      { kind: "subnet", subnet: "192.168.2.1/24", password: "hunter2hunter2" },
      codec,
      TARGET,
      async () => {
        sent += 1;
        return new Uint8Array();
      },
    );
    expect(sent).toBe(1);
    expect(networks).toHaveLength(2);
  });

  it("spends no round trip on an update that does not need the current config", async () => {
    let sent = 0;
    const networks = await readCurrentNetworks(
      { kind: "customDns", nameservers: ["1.1.1.1"] },
      codec,
      TARGET,
      async () => {
        sent += 1;
        return new Uint8Array();
      },
    );
    expect(sent).toBe(0);
    expect(networks).toEqual([]);
  });
});

describe("routerAddressForSubnet", () => {
  it("names the address the router will answer on", () => {
    expect(routerAddressForSubnet("192.168.2.1/24")).toBe("192.168.2.1");
    expect(routerAddressForSubnet("10.3.0.1/16")).toBe("10.3.0.1");
  });
});
