// Captures the restored drill-down UI: dashboard (light+dark), the Power
// detail sheet with energy history, and the Speed test sheet.
import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (pageError) => console.log("[pageerror]", pageError.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outputDir}/dash-light.png`, fullPage: true });

// Power detail (4th tile) — includes window energy + persistent energy history
await page.locator(".stat-tile-clickable").nth(3).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outputDir}/detail-power.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// Speed test sheet from the menu row
await page.locator(".menu-row", { hasText: "Speed test" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outputDir}/sheet-speedtest.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// dark dashboard
await page.locator(".theme-toggle").nth(1).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outputDir}/dash-dark.png`, fullPage: true });

await browser.close();
console.log("screenshots written");
