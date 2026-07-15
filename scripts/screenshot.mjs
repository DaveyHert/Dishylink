import { chromium } from "playwright-core";

const outputDir = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text());
});
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
// let the poll loop populate charts
await page.waitForTimeout(9000);
await page.screenshot({ path: `${outputDir}/light-full.png`, fullPage: true });

// hover the throughput chart to capture the tooltip
const chart = page.locator(".chart-body svg").first();
const chartBox = await chart.boundingBox();
if (chartBox) {
  await page.mouse.move(chartBox.x + chartBox.width * 0.6, chartBox.y + chartBox.height * 0.5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outputDir}/light-tooltip.png` });
}

await page.locator('.theme-toggle[aria-label="Toggle color theme"]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outputDir}/dark-full.png`, fullPage: true });

await browser.close();
console.log("screenshots written");
