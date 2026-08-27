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

const AT_DEFAULT_ADDRESS_AND_PERSISTENT = { addressConfigured: false, silencePersisted: true };

describe("diagnoseRouterUnreachable", () => {
  it("blames the address when a live router is unreachable from its own subnet", () => {
    const { cause, message } = diagnoseRouterUnreachable({
      ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
      presence: "present",
      onRouterSubnet: true,
    });
    expect(cause).toBe("addressTaken");
    expect(message).toContain("192.168.1.1");
  });

  it("blames the network when a live router is unreachable from elsewhere", () => {
    expect(
      diagnoseRouterUnreachable({
        ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
        presence: "present",
        onRouterSubnet: false,
      }).cause,
    ).toBe("differentNetwork");
  });

  it("offers the subnet setting to someone already on their Starlink WiFi", () => {
    // A subnet moved in the official app leaves this host holding a lease in the
    // new range while the app still dials the old default.
    const { message } = diagnoseRouterUnreachable({
      ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
      presence: "present",
      onRouterSubnet: false,
    });
    expect(message).toContain("subnet was changed");
  });

  it("reports no router when the dish says there is none", () => {
    // An enterprise kit or a powered-down router: the dish answers and names
    // nothing downstream, so our own position is irrelevant.
    for (const onRouterSubnet of [true, false, null]) {
      for (const addressConfigured of [true, false]) {
        expect(
          diagnoseRouterUnreachable({
            presence: "absent",
            onRouterSubnet,
            addressConfigured,
            silencePersisted: true,
          }).cause,
        ).toBe("noRouter");
      }
    }
  });

  it("names bypass rather than blaming the network the kit moved us onto", () => {
    // Bypass leaves the router listed downstream and moves the viewer onto a
    // CGNAT lease, so presence alone reads as a router up on another network.
    const { cause, message } = diagnoseRouterUnreachable({
      ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
      presence: "bypassed",
      onRouterSubnet: false,
    });
    expect(cause).toBe("bypassed");
    expect(message).not.toContain("Connect to your Starlink WiFi");
  });

  it("names bypass whatever our own address and settings say", () => {
    for (const onRouterSubnet of [true, false, null]) {
      for (const addressConfigured of [true, false]) {
        expect(
          diagnoseRouterUnreachable({
            presence: "bypassed",
            onRouterSubnet,
            addressConfigured,
            silencePersisted: true,
          }).cause,
        ).toBe("bypassed");
      }
    }
  });

  it("keeps bypass out of the wording for a kit with no router", () => {
    const { message } = diagnoseRouterUnreachable({
      ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
      presence: "absent",
      onRouterSubnet: null,
    });
    expect(message).not.toContain("bypass");
  });

  it("stays unknown while the dish cannot say whether a router exists", () => {
    expect(
      diagnoseRouterUnreachable({
        ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
        presence: null,
        onRouterSubnet: true,
      }).cause,
    ).toBe("unknown");
  });

  it("stays unknown when a live router is found but our own position is not", () => {
    expect(
      diagnoseRouterUnreachable({
        ...AT_DEFAULT_ADDRESS_AND_PERSISTENT,
        presence: "present",
        onRouterSubnet: null,
      }).cause,
    ).toBe("unknown");
  });

  it("gives every cause something to read", () => {
    for (const presence of ["present", "absent", "bypassed", null] as const) {
      for (const onRouterSubnet of [true, false, null]) {
        for (const addressConfigured of [true, false]) {
          for (const silencePersisted of [true, false]) {
            expect(
              diagnoseRouterUnreachable({
                presence,
                onRouterSubnet,
                addressConfigured,
                silencePersisted,
              }).message,
            ).not.toBe("");
          }
        }
      }
    }
  });

  it("names the address actually being dialled, not the default", () => {
    const message = diagnoseRouterUnreachable(
      { ...AT_DEFAULT_ADDRESS_AND_PERSISTENT, presence: null, onRouterSubnet: null },
      "192.168.2.1",
    ).message;
    expect(message).toContain("192.168.2.1");
    expect(message).not.toContain("192.168.1.1");
  });
});

describe("diagnoseRouterUnreachable with an address the user chose", () => {
  it("blames the setting, not a neighbour, wherever this device sits", () => {
    for (const onRouterSubnet of [true, false, null]) {
      const { cause, message } = diagnoseRouterUnreachable(
        { presence: "present", onRouterSubnet, addressConfigured: true, silencePersisted: true },
        "192.168.2.1",
      );
      expect(cause).toBe("configuredAddressSilent");
      expect(message).toContain("192.168.2.1");
    }
  });

  it("still reports bypass ahead of the setting", () => {
    expect(
      diagnoseRouterUnreachable({
        presence: "absent",
        onRouterSubnet: true,
        addressConfigured: true,
        silencePersisted: true,
      }).cause,
    ).toBe("noRouter");
  });
});

describe("diagnoseRouterUnreachable before the outage settles", () => {
  it("names no cause at all, however strong the signals", () => {
    // Bypass is excluded: it is a fact from the dish, so it is named at once.
    for (const presence of ["present", "absent", null] as const) {
      for (const addressConfigured of [true, false]) {
        expect(
          diagnoseRouterUnreachable({
            presence,
            onRouterSubnet: true,
            addressConfigured,
            silencePersisted: false,
          }).cause,
        ).toBe("checking");
      }
    }
  });

  it("names bypass immediately, without waiting for the silence to settle", () => {
    // The alert list stops raising the unreachability the moment the dish reports
    // the role, so a panel that waited would contradict it for 15 seconds.
    expect(
      diagnoseRouterUnreachable({
        presence: "bypassed",
        onRouterSubnet: true,
        addressConfigured: false,
        silencePersisted: false,
      }).cause,
    ).toBe("bypassed");
  });
});

describe("viewerOnRouterSubnet with a configured address", () => {
  it("places the viewer against the configured subnet", () => {
    expect(viewerOnRouterSubnet(["192.168.2.40"], "192.168.2.1")).toBe(true);
    expect(viewerOnRouterSubnet(["192.168.1.40"], "192.168.2.1")).toBe(false);
  });

  it("has no answer when the router address is IPv6", () => {
    // No /24 to compare against, so the diagnosis must stay general rather than
    // claim the viewer is off the router's network.
    expect(viewerOnRouterSubnet(["192.168.1.40"], "fdc1:5296:c0f2:10::1")).toBeNull();
  });
});

it("never suggests the address the router already answers on", () => {
  for (const routerAddress of ["192.168.1.1", "192.168.2.1", "10.0.0.1"]) {
    const { message } = diagnoseRouterUnreachable(
      { ...AT_DEFAULT_ADDRESS_AND_PERSISTENT, presence: "present", onRouterSubnet: true },
      routerAddress,
    );
    const suggestion = /different address \(like ([\d.]+)\)/.exec(message)?.[1];
    expect(suggestion).toBeDefined();
    expect(suggestion).not.toBe(routerAddress);
  }
});
