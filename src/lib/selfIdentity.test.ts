import { afterEach, describe, expect, it } from "vitest";
import {
  matchesSelf,
  resolveSelfIdentity,
  selfIdentified,
  type SelfIdentity,
} from "./selfIdentity";
import { setSelfDeviceHost } from "./selfDeviceHost";

const self = (over: Partial<SelfIdentity> = {}): SelfIdentity => ({
  ips: [],
  macs: [],
  describesHost: false,
  ...over,
});

describe("matchesSelf", () => {
  it("matches on MAC case-insensitively (Electron path)", () => {
    expect(
      matchesSelf({ macAddress: "5A:C9:44:55:F3:E9" }, self({ macs: ["5a:c9:44:55:f3:e9"] })),
    ).toBe(true);
  });

  it("matches on IPv4 (whoami / extension path)", () => {
    expect(matchesSelf({ ipAddress: "192.168.1.45" }, self({ ips: ["192.168.1.45"] }))).toBe(true);
  });

  it("unwraps IPv4-mapped IPv6 before comparing", () => {
    // whoami may report ::ffff:192.168.1.45; the router lists the bare v4.
    expect(matchesSelf({ ipAddress: "::ffff:192.168.1.45" }, self({ ips: ["192.168.1.45"] }))).toBe(
      true,
    );
  });

  it("matches on an IPv6 address (Starlink hands out v6)", () => {
    expect(matchesSelf({ ipv6Addresses: ["2600:ABCD::1"] }, self({ ips: ["2600:abcd::1"] }))).toBe(
      true,
    );
  });

  it("does not match a different device", () => {
    expect(
      matchesSelf(
        { ipAddress: "192.168.1.99", macAddress: "aa:bb:cc:dd:ee:ff" },
        self({ ips: ["192.168.1.45"] }),
      ),
    ).toBe(false);
  });

  it("never matches when identity is empty (loopback / unresolved)", () => {
    expect(
      matchesSelf({ ipAddress: "192.168.1.45", macAddress: "5a:c9:44:55:f3:e9" }, self()),
    ).toBe(false);
  });

  it("matches on a named clientId (extension path)", () => {
    expect(matchesSelf({ clientId: 12 }, self({ clientId: 12 }))).toBe(true);
  });

  it("given a clientId, still matches this machine's own addresses", () => {
    // A kept clientId is one roster read out of date after a router reset hands
    // the number to some other device, and the addresses are what cover that.
    expect(
      matchesSelf(
        { clientId: 13, ipAddress: "192.168.1.45", macAddress: "5a:c9:44:55:f3:e9" },
        self({ clientId: 12, ips: ["192.168.1.45"], macs: ["5a:c9:44:55:f3:e9"] }),
      ),
    ).toBe(true);
  });

  it("given a clientId and addresses, matches a device answering to neither", () => {
    expect(
      matchesSelf(
        { clientId: 13, ipAddress: "192.168.1.99" },
        self({ clientId: 12, ips: ["192.168.1.45"] }),
      ),
    ).toBe(false);
  });
});

describe("selfIdentified", () => {
  it("counts a named clientId, so the extension can pause once it is set", () => {
    expect(selfIdentified(self({ clientId: 12 }))).toBe(true);
    expect(selfIdentified(self({ ips: ["192.168.1.45"] }))).toBe(true);
    expect(selfIdentified(self({ macs: ["5a:c9:44:55:f3:e9"] }))).toBe(true);
    expect(selfIdentified(self())).toBe(false);
  });
});

describe("resolveSelfIdentity via a host's named device", () => {
  // A host that has nothing named answers null, which is also how these cases
  // leave the binding for whatever runs next.
  const nothingNamed = { read: () => Promise.resolve(null), write: () => Promise.resolve() };
  afterEach(() => setSelfDeviceHost(nothingNamed));

  it("names the client without claiming to describe the host's own routing", async () => {
    setSelfDeviceHost({ read: () => Promise.resolve(12), write: () => Promise.resolve() });

    await expect(resolveSelfIdentity()).resolves.toEqual({
      ips: [],
      macs: [],
      clientId: 12,
      describesHost: false,
    });
  });

  it("falls through when nothing has been named yet", async () => {
    setSelfDeviceHost(nothingNamed);

    await expect(resolveSelfIdentity()).resolves.toEqual({
      ips: [],
      macs: [],
      describesHost: false,
    });
  });
});

describe("resolveSelfIdentity via the Electron bridge", () => {
  const host = globalThis as { dishlink?: unknown };
  afterEach(() => {
    delete host.dishlink;
  });

  it("reads the host's own interfaces, which no /api call is needed for", async () => {
    host.dishlink = {
      selfIdentity: () =>
        Promise.resolve({
          ipAddresses: ["192.168.1.230", "::ffff:192.168.1.230", "127.0.0.1"],
          macAddresses: ["EA:17:B5:92:E2:92"],
        }),
    };

    await expect(resolveSelfIdentity()).resolves.toEqual({
      // Loopback is dropped and the v4-mapped duplicate collapses to the bare v4.
      ips: ["192.168.1.230", "192.168.1.230"],
      macs: ["ea:17:b5:92:e2:92"],
      describesHost: true,
    });
  });

  it("carries the roster id the host has kept, which is what answers off the network", async () => {
    host.dishlink = {
      selfIdentity: () =>
        Promise.resolve({ ipAddresses: ["10.20.30.40"], macAddresses: [], clientId: 7 }),
    };

    const identity = await resolveSelfIdentity();

    expect(identity.clientId).toBe(7);
    // The id answers even where the address cannot: the roster lists this device
    // on the router's subnet, which is not the one this machine is sitting on.
    expect(matchesSelf({ clientId: 7, ipAddress: "192.168.1.5" }, identity)).toBe(true);
    expect(matchesSelf({ clientId: 8, ipAddress: "192.168.1.6" }, identity)).toBe(false);
  });

  it("falls through when the bridge is absent, as it is on every other host", async () => {
    await expect(resolveSelfIdentity()).resolves.toMatchObject({ describesHost: false });
  });

  it("falls through when the bridge rejects", async () => {
    host.dishlink = { selfIdentity: () => Promise.reject(new Error("no ipc")) };

    await expect(resolveSelfIdentity()).resolves.toMatchObject({ describesHost: false });
  });
});
