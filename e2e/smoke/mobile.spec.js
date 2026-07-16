// e2e/smoke/mobile.spec.js
// K-19 — At 375px width, the hamburger is visible; tapping it opens the mobile nav.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test.use({ viewport: { width: 375, height: 800 } });

test("hamburger button is visible at 375px", async ({ page }) => {
  await page.goto("/");
  const hamburger = page.locator(".hamburger-btn");
  await expect(hamburger).toBeVisible();
});

test("tapping the hamburger opens the mobile nav panel", async ({ page }) => {
  await page.goto("/");
  await page.locator(".hamburger-btn").click();
  // The mobile nav slides down — .mobile-nav-open is the visible state.
  await expect(page.locator(".mobile-nav.mobile-nav-open")).toBeVisible({ timeout: 2000 });
});
