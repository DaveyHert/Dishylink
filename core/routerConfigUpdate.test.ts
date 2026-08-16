import { describe, expect, it } from "vitest";
import {
  buildRouterConfigRequest,
  normalizeNameservers,
  MAX_NAMESERVERS,
} from "./routerConfigUpdate";

const TARGET = "Router-010000000000000001B31340";

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
    expect(Object.keys(request.wifiSetConfig.wifiConfig)).toEqual([
      "nameservers",
      "applyNameservers",
    ]);
  });

  it("still sets the apply flag when clearing, so the router acts on the empty list", () => {
    const request = buildRouterConfigRequest(TARGET, { kind: "customDns", nameservers: [] });
    expect(request.wifiSetConfig.wifiConfig).toEqual({ nameservers: [], applyNameservers: true });
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
