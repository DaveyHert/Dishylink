import { describe, it, expect } from "vitest";
import {
  createRouterOrigins,
  expandIpv6,
  ROUTER_IPV4_ORIGIN,
  routerAddressesFrom,
  routerOriginsFrom,
} from "./routerEndpoint";

// The addresses this machine actually held on 2026-08-04, on a Mini whose
// router answered gRPC at fdc1:5296:c0f2:10::1 and 2605:59c1:19af:3710::1.
const GLOBAL = "2605:59c1:19af:3710:eebe:dbb2:f62:5bb0";
const GLOBAL_TEMPORARY = "2605:59c1:19af:3710:6529:4b59:2a76:ee4f";
const ULA = "fdc1:5296:c0f2:10:b0d:16d5:8cb2:95ff";
const LINK_LOCAL = "fe80::8cda:2771:60ea:2c2c%5";

describe("expandIpv6", () => {
  it("expands a compressed address to eight hextets", () => {
    expect(expandIpv6("fe80::1")).toEqual(["fe80", "0", "0", "0", "0", "0", "0", "1"]);
    expect(expandIpv6("::1")).toEqual(["0", "0", "0", "0", "0", "0", "0", "1"]);
    expect(expandIpv6("2605:59c1:19af:3710::")).toEqual([
      "2605",
      "59c1",
      "19af",
      "3710",
      "0",
      "0",
      "0",
      "0",
    ]);
  });

  it("keeps an already-full address intact", () => {
    expect(expandIpv6(GLOBAL)).toEqual([
      "2605",
      "59c1",
      "19af",
      "3710",
      "eebe",
      "dbb2",
      "f62",
      "5bb0",
    ]);
  });

  it("drops a zone id before parsing", () => {
    expect(expandIpv6(LINK_LOCAL)?.slice(0, 2)).toEqual(["fe80", "0"]);
  });

  it("rejects what it cannot reason about", () => {
    expect(expandIpv6("192.168.1.1")).toBeNull();
    expect(expandIpv6("::ffff:192.168.1.1")).toBeNull(); // IPv4-embedded
    expect(expandIpv6("2605::19af::3710")).toBeNull(); // two "::"
    expect(expandIpv6("2605:59c1:19af:3710")).toBeNull(); // too few, uncompressed
    expect(expandIpv6("2605:59c1:19af:3710:eebe:dbb2:f62:5bb0:extra")).toBeNull();
    expect(expandIpv6("zzzz::1")).toBeNull();
    expect(expandIpv6("")).toBeNull();
  });
});

describe("routerAddressesFrom", () => {
  it("derives the router's address from a global prefix", () => {
    expect(routerAddressesFrom([GLOBAL])).toEqual(["2605:59c1:19af:3710::1"]);
  });

  it("derives it from a unique-local prefix, keeping a zero-valued hextet", () => {
    // The fourth group is "10"; collapsing it would produce a second "::".
    expect(routerAddressesFrom([ULA])).toEqual(["fdc1:5296:c0f2:10::1"]);
  });

  it("yields one entry per prefix, not per address", () => {
    // A host normally holds a stable address plus temporary privacy addresses
    // in the same /64. They all point at one router.
    expect(routerAddressesFrom([GLOBAL, GLOBAL_TEMPORARY, ULA])).toEqual([
      "2605:59c1:19af:3710::1",
      "fdc1:5296:c0f2:10::1",
    ]);
  });

  it("ignores addresses that describe no reachable LAN", () => {
    // Link-local answers on the wire but cannot be put in a URL; loopback,
    // multicast and IPv4 describe nothing to derive from.
    expect(routerAddressesFrom([LINK_LOCAL, "::1", "ff02::1", "192.168.1.53"])).toEqual([]);
  });

  it("is empty when the host knows none of its own addresses", () => {
    // The browser extension's case: no way to read its own IPv6.
    expect(routerAddressesFrom([])).toEqual([]);
  });
});

describe("routerOriginsFrom", () => {
  it("always offers IPv4 first", () => {
    const origins = routerOriginsFrom([GLOBAL]);
    expect(origins[0]).toBe(ROUTER_IPV4_ORIGIN);
    expect(origins[1]).toBe("http://[2605:59c1:19af:3710::1]:9001");
  });

  it("offers IPv4 alone when nothing can be derived", () => {
    expect(routerOriginsFrom([])).toEqual([ROUTER_IPV4_ORIGIN]);
  });

  it("replaces the whole list with a configured address", () => {
    expect(routerOriginsFrom([GLOBAL], "192.168.2.1")).toEqual(["http://192.168.2.1:9001"]);
  });

  it("brackets a configured IPv6 address", () => {
    expect(routerOriginsFrom([], "fdc1:5296:c0f2:10::1")).toEqual([
      "http://[fdc1:5296:c0f2:10::1]:9001",
    ]);
  });

  it("falls back to the defaults when the configured address is unusable", () => {
    expect(routerOriginsFrom([], "192.168.2")).toEqual([ROUTER_IPV4_ORIGIN]);
    expect(routerOriginsFrom([], "")).toEqual([ROUTER_IPV4_ORIGIN]);
    expect(routerOriginsFrom([], null)).toEqual([ROUTER_IPV4_ORIGIN]);
  });
});

describe("createRouterOrigins", () => {
  const ips = () => [GLOBAL];

  it("uses IPv4 and never dials anything else when it works", async () => {
    const tried: string[] = [];
    const origins = createRouterOrigins(ips);
    await origins.run(async (origin) => {
      tried.push(origin);
      return "ok";
    });
    expect(tried).toEqual([ROUTER_IPV4_ORIGIN]);
  });

  it("falls back to the derived IPv6 origin when IPv4 fails", async () => {
    const tried: string[] = [];
    const origins = createRouterOrigins(ips);
    const result = await origins.run(async (origin) => {
      tried.push(origin);
      if (origin === ROUTER_IPV4_ORIGIN) throw new Error("ECONNREFUSED");
      return "clients";
    });
    expect(result).toBe("clients");
    expect(tried).toEqual([ROUTER_IPV4_ORIGIN, "http://[2605:59c1:19af:3710::1]:9001"]);
  });

  it("dials only the configured address, and re-reads it per call", async () => {
    let configured: string | null = null;
    const tried: string[] = [];
    const origins = createRouterOrigins(ips, () => configured);

    await origins.run(async (origin) => {
      tried.push(origin);
      return "ok";
    });
    configured = "192.168.2.1";
    await origins.run(async (origin) => {
      tried.push(origin);
      return "ok";
    });

    expect(tried).toEqual([ROUTER_IPV4_ORIGIN, "http://192.168.2.1:9001"]);
  });

  it("remembers the working origin so the next call skips the dead one", async () => {
    const origins = createRouterOrigins(ips);
    await origins.run(async (origin) => {
      if (origin === ROUTER_IPV4_ORIGIN) throw new Error("ECONNREFUSED");
      return "clients";
    });
    const tried: string[] = [];
    await origins.run(async (origin) => {
      tried.push(origin);
      return "clients";
    });
    expect(tried).toEqual(["http://[2605:59c1:19af:3710::1]:9001"]);
  });

  it("re-derives once the remembered origin stops working", async () => {
    // A kit carried to another network: the address that worked there means
    // nothing here, and must not be clung to.
    const origins = createRouterOrigins(ips);
    await origins.run(async (origin) => {
      if (origin === ROUTER_IPV4_ORIGIN) throw new Error("ECONNREFUSED");
      return "clients";
    });
    const tried: string[] = [];
    await origins.run(async (origin) => {
      tried.push(origin);
      if (origin !== ROUTER_IPV4_ORIGIN) throw new Error("ENETUNREACH");
      return "clients";
    });
    expect(tried).toEqual([
      "http://[2605:59c1:19af:3710::1]:9001", // the stale preference, tried once
      ROUTER_IPV4_ORIGIN,
    ]);
    expect(origins.current).toBe(ROUTER_IPV4_ORIGIN);
  });

  it("rethrows the last failure when nothing answers", async () => {
    const origins = createRouterOrigins(ips);
    await expect(
      origins.run(async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(origins.current).toBeNull();
  });
});
