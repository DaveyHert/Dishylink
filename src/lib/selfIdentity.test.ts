import { describe, expect, it } from "vitest";
import { matchesSelf, type SelfIdentity } from "./selfIdentity";

const self = (over: Partial<SelfIdentity> = {}): SelfIdentity => ({ ips: [], macs: [], ...over });

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
});
