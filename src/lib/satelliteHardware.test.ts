import { describe, expect, it } from "vitest";
import catalog from "./satelliteHardwareCatalog.json";
import { noradIdFromTle, resolveSatelliteHardwareVersion } from "./satelliteHardware";

describe("satellite hardware catalog", () => {
  it.each([
    ["49131", "V1.5"],
    ["55695", "V2 Mini"],
    ["58705", "V2 Mini DTC"],
    ["62100", "V2 Mini Optimized"],
  ])("resolves verified NORAD %s", (id, version) => {
    expect(resolveSatelliteHardwareVersion(id)).toBe(version);
    expect(resolveSatelliteHardwareVersion(` ${id} `)).toBe(version);
  });

  it.each([undefined, "", "99999", "49130", "A1234", "058705", "5875"])(
    "leaves unverified ID %s unknown",
    (id) => expect(resolveSatelliteHardwareVersion(id)).toBeUndefined(),
  );

  it("contains unique explicit membership with verified source counts", () => {
    const seen = new Set<string>();
    const counts: Record<string, number> = {};
    for (const [version, prefixes] of Object.entries(catalog.versions)) {
      counts[version] = 0;
      for (const [prefix, bitmap] of Object.entries(prefixes)) {
        expect(prefix).toMatch(/^\d{3}$/);
        expect(bitmap).toMatch(/^[0-9a-f]{25}$/);
        for (let suffix = 0; suffix < 100; suffix++) {
          if (Number.parseInt(bitmap[Math.floor(suffix / 4)], 16) & (1 << (suffix % 4))) {
            const id = prefix + String(suffix).padStart(2, "0");
            expect(seen.has(id)).toBe(false);
            seen.add(id);
            counts[version]++;
            expect(resolveSatelliteHardwareVersion(id)).toBe(version);
          }
        }
      }
    }
    expect(counts).toEqual({
      "V1.5": 2938,
      "V2 Mini": 2760,
      "V2 Mini DTC": 663,
      "V2 Mini Optimized": 4341,
    });
  });
});

describe("TLE NORAD identity", () => {
  it.each(["58705", "00123", "A1234"])("preserves %s as string", (id) => {
    expect(noradIdFromTle(`1 ${id}U`, `2 ${id} `)).toBe(id);
  });

  it("rejects mismatched or invalid records", () => {
    expect(noradIdFromTle("1 58705U", "2 58706 ")).toBeUndefined();
    expect(noradIdFromTle("1 12?45U", "2 12?45 ")).toBeUndefined();
    expect(noradIdFromTle("x 58705U", "2 58705 ")).toBeUndefined();
  });
});
