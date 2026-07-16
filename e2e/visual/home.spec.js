// e2e/visual/home.spec.js
// V-01 — Home page visual snapshots. Captures the composer + 5 intent chips
// + 8 capability cards in three viewports: 1280x800 light, 1280x800 dark,
// and 375x812 light (mobile).
//
// First run establishes the baseline; subsequent runs diff against it.
// Update baselines with `npx playwright test --update-snapshots`.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("home @ 1280x800 light", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("home-1280x800-light.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("home @ 1280x800 dark", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "dark"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("home-1280x800-dark.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("home @ 375x812 light (mobile)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("home-375x812-light.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
