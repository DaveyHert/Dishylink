// Captures the alignment instrument sheet, the location-setup state, and a
// live satellite overlay run (seeding a test coordinate so the TLE pipeline
// executes end-to-end).
import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (pageError) => console.log("[pageerror]", pageError.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);

// alignment sheet from the navbar
await page.locator(".topbar-link", { hasText: "Alignment" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outputDir}/sheet-alignment.png` });
await page.keyboard.press("Escape");

// location setup visible in the sky view card (fresh profile, no saved location)
await page.locator(".skydome-canvas-wrap").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${outputDir}/dome-location-setup.png` });

// seed a coordinate and let the satellite pipeline run (TLE fetch + coarse pass)
await page.evaluate(() => {
  localStorage.setItem(
    "dishylink-observer-location",
    JSON.stringify({ latitudeDeg: 6.5, longitudeDeg: 3.4, altitudeM: 40 }),
  );
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(45000); // TLE download over Starlink + propagation
await page.locator(".skydome-canvas-wrap").scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outputDir}/dome-satellites.png`, fullPage: true });

await browser.close();
console.log("screenshots written");
