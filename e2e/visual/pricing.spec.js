// e2e/visual/pricing.spec.js
// V-05 — Pricing page visual snapshots: annual default, monthly toggle, INR
// currency. These are the three "states" a paying user sees — and the
// ones most likely to regress on a token or plan-config change.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  // Baselines were captured with the Google webfonts applied, so this suite
  // opts out of the font stub in support.js. Stubbing them here would change
  // text metrics on every stored screenshot.
  await installOfflineMocks(page, { externalFonts: "allow" });
});

test("pricing annual USD (default)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("datiq.theme", "light");
      localStorage.setItem("datiq.currency", "USD");
    } catch {}
  });
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("pricing-annual-usd.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("pricing monthly USD", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("datiq.theme", "light");
      localStorage.setItem("datiq.currency", "USD");
    } catch {}
  });
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  // Click the Monthly toggle.
  await page.getByRole("button", { name: /Monthly billing/i }).click();
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot("pricing-monthly-usd.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("pricing annual INR", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("datiq.theme", "light");
      localStorage.setItem("datiq.currency", "INR");
    } catch {}
  });
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("pricing-annual-inr.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
