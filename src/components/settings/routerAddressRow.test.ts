// The decisions the address row makes before anything is sent to the host: what
// counts as savable, and what a save actually asks for.

import { describe, expect, it } from "vitest";
import { addressSavable, saveArgument } from "./routerAddressDraft";

describe("addressSavable", () => {
  it("refuses a save that would change nothing", () => {
    expect(addressSavable("192.168.2.1", "192.168.2.1")).toBe(false);
    expect(addressSavable("  192.168.2.1  ", "192.168.2.1")).toBe(false);
    expect(addressSavable("", null)).toBe(false);
  });

  it("allows clearing a stored address back to the default", () => {
    expect(addressSavable("", "192.168.2.1")).toBe(true);
    expect(addressSavable("   ", "192.168.2.1")).toBe(true);
  });

  it("allows a valid new address and refuses a half-typed one", () => {
    expect(addressSavable("192.168.2.1", null)).toBe(true);
    expect(addressSavable("fdc1:5296:c0f2:10::1", null)).toBe(true);
    expect(addressSavable("192.168.2", null)).toBe(false);
    expect(addressSavable("192.168.2.", null)).toBe(false);
    expect(addressSavable("dishy.local", null)).toBe(false);
  });
});

describe("saveArgument", () => {
  it("asks for a clear when the box is empty", () => {
    expect(saveArgument("")).toBeNull();
    expect(saveArgument("   ")).toBeNull();
  });

  it("sends the address as typed, for the host to normalise", () => {
    expect(saveArgument("  192.168.2.1 ")).toBe("192.168.2.1");
  });
});
