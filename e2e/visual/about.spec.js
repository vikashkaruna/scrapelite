// e2e/visual/about.spec.js
// V-08 — About page visual snapshot.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  // Baselines were captured with the Google webfonts applied, so this suite
  // opts out of the font stub in support.js. Stubbing them here would change
  // text metrics on every stored screenshot.
  await installOfflineMocks(page, { externalFonts: "allow" });
});

test("about page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/about");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("about-1280x900-light.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
