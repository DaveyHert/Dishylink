import { describe, it, expect } from "vitest";
import { diagnoseRouterUnreachable, viewerOnRouterSubnet } from "./routerDiagnosis";

describe("viewerOnRouterSubnet", () => {
  it("places a viewer sharing the router's /24 on its wire", () => {
    // The address a colliding TP-Link handed this machine on 2026-08-04, while
    // the Starlink router sat one hop upstream on the same numbers.
    expect(viewerOnRouterSubnet(["192.168.1.102"])).toBe(true);
  });

  it("places a viewer on any other range off it", () => {
    expect(viewerOnRouterSubnet(["192.168.0.14"])).toBe(false);
    expect(viewerOnRouterSubnet(["192.168.2.102"])).toBe(false);
    expect(viewerOnRouterSubnet(["10.0.0.5"])).toBe(false);
  });

  it("answers on any one matching address, not only the first", () => {
    expect(viewerOnRouterSubnet(["10.0.0.5", "192.168.1.53"])).toBe(true);
  });

  it("declines to guess without an IPv4 address", () => {
    // The extension resolves nothing, and a v6-only viewer says nothing about
    // where it sits in a v4 subnet. Neither is evidence of being elsewhere.
    expect(viewerOnRouterSubnet([])).toBeNull();
    expect(viewerOnRouterSubnet()).toBeNull();
    expect(viewerOnRouterSubnet(["2600:1700:ab::1"])).toBeNull();
  });

  it("does not read an IPv6 literal with an embedded v4 as a v4 address", () => {
    // It splits into four dot-separated parts, so a length check alone would
    // take it for a dotted quad and place it off-subnet with confidence.
    expect(viewerOnRouterSubnet(["2001:db8::192.168.1.1"])).toBeNull();
  });

  it("rejects malformed quads rather than placing them", () => {
    expect(viewerOnRouterSubnet(["192.168.1.999"])).toBeNull();
    expect(viewerOnRouterSubnet(["192.168.1.x"])).toBeNull();
  });
});

describe("diagnoseRouterUnreachable", () => {
  it("blames the address when a live router is unreachable from its own subnet", () => {
    const { cause, message } = diagnoseRouterUnreachable({
      routerPresent: true,
      onRouterSubnet: true,
    });
    expect(cause).toBe("addressTaken");
    expect(message).toContain("192.168.1.1");
  });

  it("blames the network when a live router is unreachable from elsewhere", () => {
    expect(diagnoseRouterUnreachable({ routerPresent: true, onRouterSubnet: false }).cause).toBe(
      "differentNetwork",
    );
  });

  it("reports no router when the dish says there is none", () => {
    // Bypass mode: the dish answers, and names nothing downstream of it. Our own
    // position is irrelevant — there is nothing at any address to reach.
    for (const onRouterSubnet of [true, false, null]) {
      expect(diagnoseRouterUnreachable({ routerPresent: false, onRouterSubnet }).cause).toBe(
        "noRouter",
      );
    }
  });

  it("stays unknown while the dish cannot say whether a router exists", () => {
    expect(diagnoseRouterUnreachable({ routerPresent: null, onRouterSubnet: true }).cause).toBe(
      "unknown",
    );
  });

  it("stays unknown when a live router is found but our own position is not", () => {
    expect(diagnoseRouterUnreachable({ routerPresent: true, onRouterSubnet: null }).cause).toBe(
      "unknown",
    );
  });

  it("gives every cause something to read", () => {
    for (const routerPresent of [true, false, null]) {
      for (const onRouterSubnet of [true, false, null]) {
        expect(diagnoseRouterUnreachable({ routerPresent, onRouterSubnet }).message).not.toBe("");
      }
    }
  });
});
