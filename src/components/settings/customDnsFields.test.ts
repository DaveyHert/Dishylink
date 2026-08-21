import { describe, expect, it } from "vitest";
import { dnsFieldsValid, nameserversFrom } from "./customDnsFields";

describe("nameserversFrom", () => {
  it("keeps a full set in order", () => {
    expect(
      nameserversFrom(["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"]),
    ).toEqual(["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"]);
  });

  it("drops blank rows without leaving a gap", () => {
    expect(nameserversFrom(["1.1.1.1", "", "1.0.0.1", ""])).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("trims surrounding whitespace", () => {
    expect(nameserversFrom(["  1.1.1.1  ", " "])).toEqual(["1.1.1.1"]);
  });

  it("returns an empty list when every field is blank", () => {
    expect(nameserversFrom(["", "", "", ""])).toEqual([]);
  });
});

describe("dnsFieldsValid", () => {
  it("accepts a primary alone", () => {
    expect(dnsFieldsValid(["1.1.1.1", "", "", ""])).toBe(true);
  });

  it("accepts a full set of IPv4 and IPv6 addresses", () => {
    expect(
      dnsFieldsValid(["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"]),
    ).toBe(true);
  });

  it("refuses every field blank — nothing to save", () => {
    expect(dnsFieldsValid(["", "", "", ""])).toBe(false);
  });

  it("refuses a blank primary even when a backup is filled — there is nothing to try first", () => {
    expect(dnsFieldsValid(["", "1.0.0.1", "", ""])).toBe(false);
  });

  it("refuses an address that does not parse", () => {
    expect(dnsFieldsValid(["1.1.1.1", "dns.google", "", ""])).toBe(false);
  });

  it("refuses a malformed IPv6 backup", () => {
    expect(dnsFieldsValid(["1.1.1.1", "2606:4700:4700:", "", ""])).toBe(false);
  });
});
