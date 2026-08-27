import { describe, it, expect } from "vitest";
import { classifyBrowserPath } from "./browserRoutes";

describe("classifyBrowserPath", () => {
  it("keeps the Vite prefix map", () => {
    expect(classifyBrowserPath("/cloud/account")).toEqual({ kind: "cloud" });
    expect(classifyBrowserPath("/api/energy?range=day")).toEqual({ kind: "api" });
    expect(classifyBrowserPath("/api/whoami")).toEqual({ kind: "whoami" });
    expect(classifyBrowserPath("/api/self-device")).toEqual({ kind: "self-device" });
    expect(classifyBrowserPath("/router-address")).toEqual({ kind: "router-address" });
    expect(classifyBrowserPath("/dishy/SpaceX.API.Device.Device/Handle")).toEqual({
      kind: "dish",
      path: "/SpaceX.API.Device.Device/Handle",
    });
    expect(classifyBrowserPath("/router/SpaceX.API.Device.Device/Handle")).toEqual({
      kind: "router",
      path: "/SpaceX.API.Device.Device/Handle",
    });
    expect(classifyBrowserPath("/celestrak/NORAD/elements/gp.php?GROUP=starlink")).toEqual({
      kind: "celestrak",
      path: "/NORAD/elements/gp.php?GROUP=starlink",
    });
    expect(classifyBrowserPath("/speedtest/__down?bytes=1000")).toEqual({
      kind: "speedtest",
      path: "/__down?bytes=1000",
    });
    expect(classifyBrowserPath("/assets/index.js")).toEqual({ kind: "static" });
  });

  it("does not treat a prefix as a substring of another path", () => {
    expect(classifyBrowserPath("/apiary")).toEqual({ kind: "static" });
    expect(classifyBrowserPath("/cloudy")).toEqual({ kind: "static" });
  });

  it("matches a proxy prefix only on a whole segment", () => {
    // Concatenated onto the upstream origin, a suffix here would name a host of
    // the caller's choosing: /celestrak.example.com -> https://celestrak.org.example.com
    expect(classifyBrowserPath("/celestrak.example.com/x")).toEqual({ kind: "static" });
    expect(classifyBrowserPath("/speedtestX/y")).toEqual({ kind: "static" });
    expect(classifyBrowserPath("/dishyEVIL/z")).toEqual({ kind: "static" });
    expect(classifyBrowserPath("/routerEVIL/w")).toEqual({ kind: "static" });
    expect(classifyBrowserPath("/dishy")).toEqual({ kind: "dish", path: "/" });
    expect(classifyBrowserPath("/router-address")).toEqual({ kind: "router-address" });
  });
});
