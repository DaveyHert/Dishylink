import catalog from "./satelliteHardwareCatalog.json";

export type SatelliteHardwareVersion = keyof typeof catalog.versions | "V3";

// Decode only catalog membership, never infer from NORAD ranges or satellite names.
const versionsByNoradId = new Map<string, SatelliteHardwareVersion>();
for (const [version, prefixes] of Object.entries(catalog.versions)) {
  for (const [prefix, bitmap] of Object.entries(prefixes)) {
    for (let suffix = 0; suffix < 100; suffix++) {
      const nibble = Number.parseInt(bitmap[Math.floor(suffix / 4)], 16);
      if (nibble & (1 << (suffix % 4))) {
        versionsByNoradId.set(
          prefix + String(suffix).padStart(2, "0"),
          version as SatelliteHardwareVersion,
        );
      }
    }
  }
}

export function resolveSatelliteHardwareVersion(
  noradId: string | undefined,
): SatelliteHardwareVersion | undefined {
  return noradId === undefined ? undefined : versionsByNoradId.get(noradId.trim());
}

/** Preserve leading zeroes and Alpha-5 identifiers; require matching TLE lines. */
export function noradIdFromTle(line1: string, line2: string): string | undefined {
  const id = line1.slice(2, 7).trim();
  return line1.startsWith("1 ") &&
    line2.startsWith("2 ") &&
    /^[0-9A-Z]{5}$/.test(id) &&
    id === line2.slice(2, 7).trim()
    ? id
    : undefined;
}
