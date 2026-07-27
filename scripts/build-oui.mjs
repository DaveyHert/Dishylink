// Generates public/oui.json: a compact { "hex6": "Vendor" } map from the IEEE
// MA-L (OUI) registry, so device manufacturers can be resolved locally from a
// MAC's first three octets. Served as a static asset and fetched lazily by
// macVendor.ts (kept out of the JS bundle and out of TS type-checking).
// Re-run to refresh: `node scripts/build-oui.mjs`.
//
// Only fixed (universally-administered) MACs carry a real OUI; randomized MACs
// on modern phones encode no vendor and are handled separately in macVendor.ts.

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUI_CSV_URL = "https://standards-oui.ieee.org/oui/oui.csv";
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/oui.json");

/** Parse one CSV line into fields, honoring double-quoted fields with commas. */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = false;
      } else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}

/** Trim common corporate suffixes so values read like the official app's short brand. */
function tidyVendor(name) {
  return (
    name
      .replace(
        /[,.]?\s+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|LLC|GmbH|AG|S\.?A\.?|B\.?V\.?|Pty|Technologies|Technology|Electronics|Communications)\.?$/i,
        "",
      )
      .trim() || name.trim()
  );
}

console.log(`Fetching ${OUI_CSV_URL} …`);
const response = await fetch(OUI_CSV_URL);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const csv = await response.text();

const lines = csv.split(/\r?\n/);
const map = {};
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const [, assignment, org] = parseCsvLine(lines[i]);
  if (!assignment || !org) continue;
  const hex6 = assignment.trim().toLowerCase();
  if (hex6.length !== 6) continue;
  map[hex6] = tidyVendor(org.trim());
}

// Consumer-brand overrides applied after the IEEE parse (so they win). IEEE
// lets a company withhold its name — it then lists as "Private" — and some
// brands register under an OEM name. These map the OUI to the brand a user
// recognizes. Govee (Shenzhen Intellirocks) hides two of its blocks as
// "Private" and uses the Intellirocks name on a third.
const BRAND_OVERRIDES = {
  "6074f4": "Govee",
  d0c907: "Govee",
  d4adfc: "Govee",
};
Object.assign(map, BRAND_OVERRIDES);

const count = Object.keys(map).length;
writeFileSync(outPath, JSON.stringify(map));
console.log(`Wrote ${count} OUIs → ${outPath}`);
