// Verifies the last feature batch: Network sheet, Data usage sheet,
// Terminal reboot/stow controls, and the ticked time-lapse scrubber.
import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (pageError) => console.log("[pageerror]", pageError.message));

await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem(
    "dishylink-observer-location",
    JSON.stringify({ latitudeDeg: 6.5, longitudeDeg: 3.4, altitudeM: 40 }),
  );
  localStorage.setItem("dishylink-theme", "dark");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);

await page.locator(".topbar-link", { hasText: "Network" }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outputDir}/sheet-network.png` });
await page.keyboard.press("Escape");

await page.locator(".topbar-link", { hasText: "Data usage" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outputDir}/sheet-datausage.png` });
await page.keyboard.press("Escape");

// Terminal panel with reboot/stow buttons (arm the confirm for the shot)
await page.locator(".card-title", { hasText: "Terminal" }).scrollIntoViewIfNeeded();
await page.locator(".device-action-button", { hasText: "Reboot dish" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${outputDir}/terminal-actions.png` });
await page.locator(".device-action-button", { hasText: "Cancel" }).click();

// scrubber ticks in the immersive sky view
await page.locator(".card-link", { hasText: "Satellite view" }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outputDir}/skyview-scrubber.png` });

await browser.close();
console.log("screenshots written");
