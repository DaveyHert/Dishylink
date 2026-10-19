// Builds build/icon.icns and build/icon.png from build/icon.svg.
//
// build/icon.svg is the only hand-maintained form of the mark. The .icns is the
// packaged app's bundle icon; the .png is what electron/main.ts loads at runtime
// for the tray and, in dev, the dock. Both derive from the SVG so the two rasters
// cannot drift away from the vector or from each other.
//
// electron-builder can convert an icon itself, but its ICNS writer corrupts the
// legacy small representations: 16, 32 and 48 px come out as random colour noise
// while every size from 128 up (stored as embedded PNGs) is correct. macOS draws
// list views, the Get Info header and the menu bar from those small slices, so the
// app shows noise everywhere except the Dock. Feeding electron-builder a finished
// .icns skips its converter entirely — `mac.icon` takes an .icns as a first-class
// input. Source format makes no difference to the bug; SVG and PNG inputs both
// come out corrupt, so this is about who writes the container, not what goes in.
//
// sips rasterizes the SVG once per target size rather than downsampling a single
// large raster, which keeps the 16 and 32 px slices legible. iconutil then packs
// them, and it writes the legacy types correctly.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "build", "icon.svg");
const output = join(root, "build", "icon.icns");
const runtimePng = join(root, "build", "icon.png");
const trayTemplates = ["trayTemplate", "trayTemplateOutline"];

// The ten representations iconutil accepts. Anything outside this set makes it
// reject the whole iconset rather than skip the odd entry.
const slices = [
  [16, "icon_16x16"],
  [32, "icon_16x16@2x"],
  [32, "icon_32x32"],
  [64, "icon_32x32@2x"],
  [128, "icon_128x128"],
  [256, "icon_128x128@2x"],
  [256, "icon_256x256"],
  [512, "icon_256x256@2x"],
  [512, "icon_512x512"],
  [1024, "icon_512x512@2x"],
];

const rasterize = (size, destination, input = source) =>
  execFileSync(
    "sips",
    ["-s", "format", "png", "-z", String(size), String(size), input, "--out", destination],
    { stdio: "pipe" },
  );

const work = mkdtempSync(join(tmpdir(), "dishylink-icon-"));
const iconset = join(work, "icon.iconset");
mkdirSync(iconset);

try {
  for (const [size, name] of slices) {
    rasterize(size, join(iconset, `${name}.png`));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", output], { stdio: "inherit" });
  rasterize(1024, runtimePng);
  for (const name of trayTemplates) {
    const svg = join(root, "build", `${name}.svg`);
    rasterize(16, join(root, "build", `${name}.png`), svg);
    rasterize(32, join(root, "build", `${name}@2x.png`), svg);
  }
  console.log(`icon: ${output}\nicon: ${runtimePng}\nicon: ${trayTemplates.join(", ")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
