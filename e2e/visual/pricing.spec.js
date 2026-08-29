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
  // Cross-run flakiness on this page traced to the .rise/.fade stagger
  // animation: Playwright's own animation-disabling normally jumps
  // straight to the end state, but this page still produced ~250px
  // height differences between otherwise-identical runs. The app
  // already has a real, tested off switch for these animations
  // (prefers-reduced-motion, design-system.css) — using that instead
  // of relying on Playwright's runtime CSS injection removes the
  // animation entirely rather than merely zeroing its duration, which
  // is what makes the settled layout height deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
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
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
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
  // externalFonts:"allow" means these two pages fetch real Google Fonts,
  // and network-timed font swaps can still be mid-reflow when
  // networkidle fires — that race showed up as a ~250px height
  // difference between otherwise-identical runs. document.fonts.ready
  // is the actual signal that every requested font face has finished
  // loading and applied, so waiting on it is what makes the page's
  // final layout height deterministic before the screenshot is taken.
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("pricing-annual-inr.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
