// Verifies the ticked time-lapse scrubber by duplicating the one real
// snapshot into a fake 4-hour history (display-only seed, real cell data).
import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000); // let one real snapshot persist

const seeded = await page.evaluate(() => {
  const raw = localStorage.getItem("dishboard-obstruction-snapshots");
  if (!raw) return false;
  const snapshots = JSON.parse(raw);
  if (snapshots.length === 0) return false;
  const base = snapshots[snapshots.length - 1];
  const seededList = [1, 2, 3, 4]
    .map((hoursAgo) => ({ ...base, takenAtMs: base.takenAtMs - hoursAgo * 3_600_000 }))
    .reverse()
    .concat([base]);
  localStorage.setItem("dishboard-obstruction-snapshots", JSON.stringify(seededList));
  localStorage.setItem(
    "dishboard-observer-location",
    JSON.stringify({ latitudeDeg: 6.5, longitudeDeg: 3.4, altitudeM: 40 }),
  );
  localStorage.setItem("dishboard-theme", "dark");
  return true;
});
console.log("seeded:", seeded);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.locator(".card-link", { hasText: "Satellite view" }).click();
await page.waitForTimeout(1500);

// drag the scrubber to a historical stop
const slider = page.locator('.scrub-track input[type="range"]');
await slider.focus();
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(600);
await page.screenshot({ path: `${outputDir}/skyview-scrubber-ticks.png` });

await browser.close();
console.log("screenshots written");
