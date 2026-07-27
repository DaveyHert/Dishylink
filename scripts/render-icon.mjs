// Rasterize an SVG to a square, transparent PNG at a given size, by rendering it
// in Chromium (via Playwright) and screenshotting with the background omitted.
// QuickLook mis-scales SVGs and flattens transparency, so it cannot be used.
//
//   node scripts/render-icon.mjs <input.svg> <output.png> [size=1024]

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [svgPath, outPath, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg ?? 1024);

let svg = readFileSync(svgPath, "utf8");
// Force the root <svg> to the target pixel size; its viewBox keeps the artwork's
// proportions. Only the first width/height (the root's) are replaced.
svg = svg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`);

const html = `<!doctype html><meta charset="utf8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(`wrote ${outPath} (${size}x${size})`);
