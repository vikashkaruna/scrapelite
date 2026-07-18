// Recapture only the home-page V1.0 screenshots that changed.
import { chromium } from "playwright";
import { join } from "node:path";
const OUT = "/Users/vikash/Extracta/docs/V1.0-Screenshots";
const BASE = "http://127.0.0.1:5173";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log("  ✓", name);
};

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  try {
    localStorage.setItem("datiq.theme", "light");
    localStorage.setItem("datiq.currency", "USD");
    localStorage.setItem("datiq.onboardingTour.v1", JSON.stringify({ skippedAt: "1970-01-01T00:00:00.000Z" }));
  } catch {}
});
await sleep(800);

// 01 — Home (desktop, light) — fresh capture with the new layout
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await sleep(800);
await shot("01-home-desktop-light.png");

// 23 — Home with active outcome tile
const tile = page.locator(".outcome-tile").first();
if (await tile.count()) {
  await tile.click();
  await sleep(500);
  await shot("23-home-outcome-tile-active.png");
}

await browser.close();
console.log("\nDone.");
