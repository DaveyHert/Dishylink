import { describe, expect, it } from "vitest";
import { normalizeIpAddress, originFor } from "./ipAddress";

describe("normalizeIpAddress", () => {
  it("accepts the addresses the two boxes are actually moved to", () => {
    expect(normalizeIpAddress("192.168.2.1")).toBe("192.168.2.1");
    expect(normalizeIpAddress("10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIpAddress("  192.168.4.1  ")).toBe("192.168.4.1");
  });

  it("accepts IPv6, bracketed or bare, and lowercases it", () => {
    expect(normalizeIpAddress("fdc1:5296:c0f2:10::1")).toBe("fdc1:5296:c0f2:10::1");
    expect(normalizeIpAddress("[FDC1:5296:C0F2:10::1]")).toBe("fdc1:5296:c0f2:10::1");
    expect(normalizeIpAddress("2605:59c1:19af:3710::1")).toBe("2605:59c1:19af:3710::1");
  });

  it("drops a zone id rather than rejecting the address", () => {
    expect(normalizeIpAddress("fdc1:5296:c0f2:10::1%en0")).toBe("fdc1:5296:c0f2:10::1");
  });

  it("rejects anything that is not a literal address", () => {
    expect(normalizeIpAddress("")).toBeNull();
    expect(normalizeIpAddress("   ")).toBeNull();
    expect(normalizeIpAddress("dishy.local")).toBeNull();
    expect(normalizeIpAddress("http://192.168.1.1")).toBeNull();
    expect(normalizeIpAddress("192.168.1.1:9001")).toBeNull();
    expect(normalizeIpAddress("192.168.1")).toBeNull();
    expect(normalizeIpAddress("192.168.1.256")).toBeNull();
    expect(normalizeIpAddress("192.168.1.1.1")).toBeNull();
  });

  it("rejects leading-zero octets, which some resolvers read as octal", () => {
    expect(normalizeIpAddress("192.168.01.1")).toBeNull();
    expect(normalizeIpAddress("010.0.0.1")).toBeNull();
  });
});

describe("originFor", () => {
  it("brackets IPv6 and leaves IPv4 alone", () => {
    expect(originFor("192.168.2.1", 9001)).toBe("http://192.168.2.1:9001");
    expect(originFor("fdc1:5296:c0f2:10::1", 9001)).toBe("http://[fdc1:5296:c0f2:10::1]:9001");
  });

  it("builds a URL the platform URL parser accepts", () => {
    expect(new URL(originFor("fdc1:5296:c0f2:10::1", 9201)).port).toBe("9201");
  });
});
