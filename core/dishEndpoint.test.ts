import { describe, expect, it } from "vitest";
import { DISH_IPV4_ORIGIN, dishHandleUrlFrom, dishOriginFrom } from "./dishEndpoint";

describe("dishOriginFrom", () => {
  it("dials the firmware default when nothing is configured", () => {
    expect(dishOriginFrom()).toBe("http://192.168.100.1:9201");
    expect(dishOriginFrom(null)).toBe(DISH_IPV4_ORIGIN);
  });

  it("dials the configured address on the dish's fixed port", () => {
    expect(dishOriginFrom("192.168.1.1")).toBe("http://192.168.1.1:9201");
    expect(dishOriginFrom(" 10.0.0.2 ")).toBe("http://10.0.0.2:9201");
  });

  it("brackets an IPv6 address, as a URL requires", () => {
    expect(dishOriginFrom("fd00::1")).toBe("http://[fd00::1]:9201");
  });

  it("falls back to the default for something that is not an address", () => {
    expect(dishOriginFrom("dish.local")).toBe(DISH_IPV4_ORIGIN);
    expect(dishOriginFrom("192.168.1.1:9201")).toBe(DISH_IPV4_ORIGIN);
  });
});

describe("dishHandleUrlFrom", () => {
  it("appends the Device service path to the chosen origin", () => {
    expect(dishHandleUrlFrom("192.168.1.1")).toBe(
      "http://192.168.1.1:9201/SpaceX.API.Device.Device/Handle",
    );
  });
});
