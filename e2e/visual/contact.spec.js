// e2e/visual/contact.spec.js
// V-06 — Contact page visual snapshot. Verifies the ?type=bug pre-fill
// (FR: contact form pre-fills based on query param) and the support form.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("contact with ?type=bug pre-fill", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { try { localStorage.setItem("datiq.theme", "light"); } catch {} });
  await page.goto("/contact?type=bug");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("contact-type-bug-prefill.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
