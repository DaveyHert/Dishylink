// Captures: standard Obstructions card, the immersive Sky view sheet with
// live satellites, and the ported alignment instruments.
import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (pageError) => console.log("[pageerror]", pageError.message));

// seed observer location so the satellite pipeline runs
await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem(
    "dishylink-observer-location",
    JSON.stringify({ latitudeDeg: 6.5, longitudeDeg: 3.4, altitudeM: 40 }),
  );
  localStorage.setItem("dishylink-theme", "dark");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(20000); // cached TLEs + coarse pass

await page.locator(".skydome-canvas-wrap").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outputDir}/standard-obstructions.png` });

await page.locator(".card-link", { hasText: "Satellite view" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outputDir}/immersive-skyview.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.locator(".topbar-link", { hasText: "Alignment" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outputDir}/alignment-ported.png` });

await browser.close();
console.log("screenshots written");
